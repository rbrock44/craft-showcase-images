#!/usr/bin/env node
/**
 * Adds drawings to this gallery: writes them under images/ and lists them in project-list.json.
 *
 * For every input image it writes three files:
 *   <name>.jpg        full copy: long edge capped at 1200px, metadata stripped, watermarked, quality 80
 *   <name>-mid.webp   fits 1200x1200, quality 80, made from the watermarked full copy
 *   <name>-thumb.webp 400px wide, quality 75, made from the watermarked full copy
 *
 * Usage:
 *   node scripts/add-images.mjs --year 2025 [--project "Barn Owl"] [--desc "..."] [--featured]
 *        [--original-price 300] [--copies large|none|<preset-or-id>,...]
 *        [--root <gallery folder>] [--data <path/to/project-list.json>] [--dry-run] <file-or-folder>...
 *   node scripts/add-images.mjs --about [--root <gallery folder>] [--dry-run] <file-or-folder>...
 *
 * With --about each picture is a photo for the site's About panel (the artist, their studio) and only one
 * file is written, with no watermark and nothing added to project-list.json:
 *   about/<name>.jpg  long edge capped at 1200px, metadata (camera, location) stripped, quality 82
 *
 * Settings (watermark text, id prefix) come from <root>/site.json; root defaults to this repo.
 *
 * Also imported by import.mjs, which uses the exported functions.
 *
 * Requires ImageMagick 7 (magick) on PATH. No npm packages.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Folder (under the gallery root) and url prefix the published images live at. */
const IMAGES_FOLDER = 'images';
const IMAGES_URL = '/images';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

const FULL_MAX_EDGE = 1200;
const FULL_QUALITY = 80;
const MID_BOX = 1200;
const MID_QUALITY = 80;
const THUMB_WIDTH = 400;
const THUMB_QUALITY = 75;
// About photos show the artist, not their work, so they are only resized and stripped
const ABOUT_FOLDER = 'about';
const ABOUT_MAX_EDGE = 1200;
const ABOUT_QUALITY = 82;

// Watermark layers, all sized from markScale() so they scale with the image
const VISIBLE = { size: 0.032, fill: 'rgba(255,255,255,0.60)', stroke: 'rgba(40,40,40,0.55)' };
const TILED = { size: 0.045, fill: 'rgba(110,110,110,0.06)', angle: -30 };
const HIDDEN = { size: 0.022, fill: 'rgba(128,128,128,0.02)', minCopies: 3, maxCopies: 5 };

const USAGE = `Usage:
  node scripts/add-images.mjs --year <yyyy> [--project "<name>"] [--desc "<text>"] [--featured]
       [--original-price <dollars>] [--copies <preset-or-ids>]
       [--root <gallery folder>] [--data <project-list.json>] [--dry-run] <file-or-folder>...
  node scripts/add-images.mjs --about [--root <gallery folder>] [--dry-run] <file-or-folder>...

  --year      year the images belong to
  --project   project name; without it the images are loose photos for that year
  --desc      project description for a new project (or the image desc for loose photos)
  --featured  show the project (or the loose photos being added) in the site's Featured group
  --original-price
              put each original up for sale at this price, in whole dollars (300 is $300)
  --copies    which copies each picture offers: a preset name from site.json's shop ("large"), several
              preset names or variant ids separated by commas ("cards,print-8x10"), or "none".
              Without it pictures offer the shop's default preset
  --root      gallery folder holding site.json, project-list.json and images/ (default: this repo)
  --data      project-list.json to update instead of <root>/project-list.json
  --about     photos for the site's About panel (you, your studio): resized into images/about/ without
              a watermark and not listed in project-list.json; link them from about.md. No --year
  --dry-run   show what would happen without writing anything`;

/** A problem with the input or settings, shown to the user without a stack trace. */
export class AddImagesError extends Error {}

function fail(message) {
  throw new AddImagesError(message);
}

function parseArgs(argv) {
  const options = { inputs: [], dryRun: false, featured: false, about: false };
  const valued = {
    '--root': 'root', '--year': 'year', '--project': 'project', '--desc': 'desc', '--data': 'data',
    '--original-price': 'originalPrice', '--copies': 'copies',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--about') {
      options.about = true;
    } else if (arg === '--featured') {
      options.featured = true;
    } else if (valued[arg]) {
      if (i + 1 >= argv.length) fail(`${arg} needs a value`);
      options[valued[arg]] = argv[++i];
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}\n\n${USAGE}`);
    } else {
      options.inputs.push(arg);
    }
  }
  if (options.about && (options.year !== undefined || options.project !== undefined)) fail('--about photos take no --year or --project');
  if (!options.about && !/^\d{4}$/.test(options.year ?? '')) fail(`--year must be a 4 digit year\n\n${USAGE}`);
  if (options.project !== undefined && !slugify(options.project)) fail('--project needs letters or numbers');
  if (options.inputs.length === 0) fail(`no input files or folders given\n\n${USAGE}`);
  if (options.originalPrice !== undefined) {
    const price = Number(options.originalPrice);
    if (options.originalPrice.trim() === '' || !Number.isFinite(price) || price < 0) fail('--original-price must be a price in dollars, like 300');
    options.originalPrice = price;
  }
  if (options.copies !== undefined) options.copies = parseCopies(options.copies);
  return options;
}

/** --copies as project-list.json writes it: false for "none", one name, or a list of names. */
export function parseCopies(value) {
  const names = value.split(',').map((name) => name.trim()).filter((name) => name !== '');
  if (names.length === 0) fail('--copies needs a preset name, variant ids, or "none"');
  if (names.length === 1 && (names[0] === 'none' || names[0] === 'false')) return false;
  return names.length === 1 ? names[0] : names;
}

/** Fails on a --copies name that isn't a preset or variant in site.json's shop. */
export function checkCopies(copies, settings) {
  if (copies === undefined || copies === false) return;
  const shop = settings.shop ?? {};
  const known = new Set([...Object.keys(shop.presets ?? {}), ...Object.keys(shop.variants ?? {})]);
  for (const name of [copies].flat()) {
    if (!known.has(name)) fail(`--copies "${name}" is not a preset or variant in site.json's shop (known: ${[...known].join(', ') || 'none'})`);
  }
}

/** The sale entry for --original-price and --copies, or undefined when neither is given. */
export function saleFor({ originalPrice, copies }) {
  if (originalPrice === undefined && copies === undefined) return undefined;
  const sale = {};
  if (originalPrice !== undefined) sale.original = { price: originalPrice, sold: false };
  if (copies !== undefined) sale.copies = copies;
  return sale;
}

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function magick(args) {
  try {
    return execFileSync('magick', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') fail('ImageMagick (magick) is not installed or not on PATH');
    throw new Error(`magick ${args.join(' ')}\n${error.stderr || error.message}`);
  }
}

/** Throws unless ImageMagick can be run. */
export function checkMagick() {
  magick(['-version']);
}

/** The gallery's settings from <root>/site.json. */
export function loadSite(repoRoot = REPO_ROOT) {
  const settingsPath = path.join(repoRoot, 'site.json');
  if (!fs.existsSync(settingsPath)) fail(`no site settings at ${settingsPath}`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  for (const key of ['watermarkText', 'idPrefix']) {
    if (!settings[key]) fail(`${settingsPath} is missing "${key}"`);
  }
  return settings;
}

export function defaultDataPath(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'project-list.json');
}

export function readData(dataPath) {
  if (!fs.existsSync(dataPath)) fail(`data file not found: ${dataPath}`);
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

export function writeData(dataPath, data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
}

/** Where an image goes: `images/<year>` or `images/<year>/<project-slug>` under the gallery root. */
export function destinationFor({ year, project, repoRoot = REPO_ROOT }) {
  const relativeDir = project !== undefined && project !== null ? `${year}/${slugify(project)}` : String(year);
  return { relativeDir, dir: path.join(repoRoot, IMAGES_FOLDER, ...relativeDir.split('/')) };
}

/** Published name for a source file: its base name slugified. */
export function imageName(source) {
  return slugify(path.parse(source).name);
}

export function imageId(source, settings) {
  const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  return `${settings.idPrefix}-${hash.slice(0, 8)}`;
}

/** Temporary folder for watermark tiles; call the returned function to remove it. */
export function makeWorkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-images-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Makes the three published files for one source image and returns its project-list entry plus
 * the files written. With dryRun, only works out the size. Throws on failure, after removing
 * any of its own files it had already written.
 */
export function processImage({ source, name, destination, settings, workDir, desc = '', dryRun = false }) {
  const id = imageId(source, settings);
  const full = path.join(destination.dir, `${name}.jpg`);
  const mid = path.join(destination.dir, `${name}-mid.webp`);
  const thumb = path.join(destination.dir, `${name}-thumb.webp`);
  let size = fullSize(source);
  const files = [];
  if (!dryRun) {
    fs.mkdirSync(destination.dir, { recursive: true });
    try {
      files.push(full);
      makeFull(source, full, size, settings, id, workDir);
      files.push(mid, thumb);
      makeDerived(full, mid, thumb);
      size = readSize(full);
    } catch (error) {
      for (const file of files) fs.rmSync(file, { force: true });
      throw error;
    }
  }
  const image = { name, desc, url: `${IMAGES_URL}/${destination.relativeDir}/${name}.jpg`, width: size.width, height: size.height };
  return { image, id, files };
}

function collectInputs(inputs) {
  const files = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) fail(`not found: ${input}`);
    if (fs.statSync(resolved).isDirectory()) {
      const entries = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(resolved, entry.name))
        .sort();
      if (entries.length === 0) console.warn(`No .jpg/.jpeg/.png files in ${input}`);
      files.push(...entries);
    } else if (IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
      files.push(resolved);
    } else {
      console.warn(`Skipping ${input}: not a .jpg, .jpeg or .png`);
    }
  }
  return files;
}

/** Small seeded generator (mulberry32) so the hidden marks land in the same spots on every run. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Positions for the hidden id marks. The tiled text runs diagonally through the middle of each tile,
 * so the horizontal band along every tile edge is clear; the marks sit in those bands so the tiling
 * never covers them. Which bands and where along them comes from a generator seeded with the id.
 */
function hiddenMarkPositions(id, width, height, tile, pointSize, text) {
  const random = seededRandom(parseInt(id.split('-').pop(), 16));
  const count = HIDDEN.minCopies + Math.floor(random() * (HIDDEN.maxCopies - HIDDEN.minCopies + 1));
  const textWidth = Math.ceil(text.length * pointSize * 0.6);
  const halfHeight = Math.ceil(pointSize * 0.6);
  const columns = width / 2 >= textWidth ? 2 : 1;
  const slotWidth = width / columns;
  const slots = [];
  for (let row = 1; row * tile.height + halfHeight < height; row++) {
    for (let column = 0; column < columns; column++) slots.push({ row, column });
  }
  if (slots.length === 0) slots.push({ row: 0.5, column: 0 });
  const positions = [];
  for (let i = 0; i < count && slots.length > 0; i++) {
    const { row, column } = slots.splice(Math.floor(random() * slots.length), 1)[0];
    const span = Math.max(0, slotWidth - textWidth);
    const x = Math.round(column * slotWidth + random() * span);
    const y = Math.round(row * tile.height - halfHeight);
    positions.push({ x: Math.max(0, x), y: Math.max(0, y) });
  }
  return positions;
}

/**
 * Length the watermark sizes are taken from: the short edge, but at least half the long edge so
 * very narrow images still get marks big enough to read back after JPEG compression.
 */
function markScale(width, height) {
  return Math.max(Math.min(width, height), Math.max(width, height) / 2);
}

/** Pixel size of the full copy: auto-oriented, long edge capped, never upscaled. */
function fullSize(source) {
  const geometry = `${FULL_MAX_EDGE}x${FULL_MAX_EDGE}>`;
  const [width, height] = magick([source + '[0]', '-auto-orient', '-resize', geometry, '-format', '%w %h', 'info:'])
    .trim()
    .split(/\s+/)
    .map(Number);
  return { width, height };
}

function makeTile(tilePath, width, height, text) {
  const pointSize = Math.max(14, Math.round(markScale(width, height) * TILED.size));
  // Wide, roomy tiles: the text crosses each tile's middle and leaves a clear band along its edges
  const tileWidth = Math.round(pointSize * text.length * 0.6 * 1.5);
  const tileHeight = Math.round(tileWidth * 0.55);
  magick([
    '-size', `${tileWidth}x${tileHeight}`, 'xc:none',
    '-font', 'Arial-Bold', '-pointsize', String(pointSize), '-fill', TILED.fill,
    '-gravity', 'center', '-annotate', `${TILED.angle}x${TILED.angle}+0+0`, text,
    tilePath,
  ]);
  return { width: tileWidth, height: tileHeight };
}

function makeFull(source, destination, size, settings, id, workDir) {
  const { width, height } = size;
  const scale = markScale(width, height);
  const markText = `© ${settings.watermarkText}`;
  const tilePath = path.join(workDir, 'tile.png');
  const tile = makeTile(tilePath, width, height, markText);

  const args = [
    source + '[0]', '-auto-orient', '-resize', `${FULL_MAX_EDGE}x${FULL_MAX_EDGE}>`, '-strip',
    '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'sRGB',
    // b. faint tiled text across the whole image
    '(', '-size', `${width}x${height}`, `tile:${tilePath}`, ')', '-compose', 'over', '-composite',
  ];

  // c. nearly invisible id marks at seeded positions
  const hiddenText = `${settings.watermarkText} ${id}`;
  const hiddenSize = Math.max(16, Math.round(scale * HIDDEN.size));
  args.push('-font', 'Arial-Bold', '-pointsize', String(hiddenSize), '-fill', HIDDEN.fill, '-stroke', 'none', '-gravity', 'northwest');
  for (const { x, y } of hiddenMarkPositions(id, width, height, tile, hiddenSize, hiddenText)) {
    args.push('-annotate', `+${x}+${y}`, hiddenText);
  }

  // a. visible corner mark
  const visibleSize = Math.max(16, Math.round(scale * VISIBLE.size));
  const margin = Math.round(visibleSize * 0.6);
  const strokeWidth = Math.max(1, Math.round((visibleSize / 30) * 10) / 10);
  args.push(
    '-pointsize', String(visibleSize), '-fill', VISIBLE.fill,
    '-stroke', VISIBLE.stroke, '-strokewidth', String(strokeWidth),
    '-gravity', 'southeast', '-annotate', `+${margin}+${margin}`, markText,
    '-set', 'comment', `© ${settings.watermarkText} ${id}`,
    '-quality', String(FULL_QUALITY), destination,
  );
  magick(args);
}

function makeDerived(full, mid, thumb) {
  magick([full, '-resize', `${MID_BOX}x${MID_BOX}>`, '-strip', '-quality', String(MID_QUALITY), mid]);
  magick([full, '-resize', `${THUMB_WIDTH}x>`, '-strip', '-quality', String(THUMB_QUALITY), thumb]);
}

function readSize(file) {
  const [width, height] = magick([file, '-format', '%w %h', 'info:']).trim().split(/\s+/).map(Number);
  return { width, height };
}

/**
 * Adds images to the data, creating the year and project when missing. Only ever adds: existing
 * entries keep their place, and a project's desc is only set when it is new or still empty.
 * With featured, the project (or each loose photo added) is marked `featured: true`; it never unmarks.
 * Returns how many images were added (ones whose url is already listed are left alone).
 */
export function mergeIntoData(data, { year, project, desc, images, featured = false }) {
  year = String(year);
  if (!Array.isArray(data.projectsByYear)) data.projectsByYear = [];
  let yearEntry = data.projectsByYear.find((entry) => String(entry.year) === year);
  if (!yearEntry) {
    yearEntry = { year, projects: [] };
    // Insert so years stay newest first, without moving any existing entry
    const index = data.projectsByYear.findIndex((entry) => Number(entry.year) < Number(year));
    if (index === -1) data.projectsByYear.push(yearEntry);
    else data.projectsByYear.splice(index, 0, yearEntry);
  }
  if (!Array.isArray(yearEntry.projects)) yearEntry.projects = [];

  let target;
  if (project !== undefined && project !== null) {
    let projectEntry = yearEntry.projects.find((entry) => slugify(entry.name) === slugify(project));
    if (!projectEntry) {
      projectEntry = { name: project, desc: desc ?? '', images: [] };
      yearEntry.projects.push(projectEntry);
    } else if (desc && !projectEntry.desc) {
      projectEntry.desc = desc;
    }
    if (featured) projectEntry.featured = true;
    if (!Array.isArray(projectEntry.images)) projectEntry.images = [];
    target = projectEntry.images;
  } else {
    if (!Array.isArray(yearEntry.images)) yearEntry.images = [];
    target = yearEntry.images;
  }

  // Loose photos are listed after the year's newest project at the time they're added, so the site
  // keeps them where they came: photos, then projects, then more photos.
  const after = target === yearEntry.images ? yearEntry.projects.at(-1)?.name : undefined;

  let added = 0;
  for (const image of images) {
    if (target.some((existing) => existing.url === image.url)) continue;
    const entry = after ? { ...image, after } : { ...image };
    if (featured && target === yearEntry.images) entry.featured = true;
    target.push(entry);
    added++;
  }
  return added;
}

/** Where About photos go: images/about/ under the gallery root. */
export function aboutDestination(repoRoot = REPO_ROOT) {
  return { relativeDir: ABOUT_FOLDER, dir: path.join(repoRoot, IMAGES_FOLDER, ABOUT_FOLDER) };
}

/** Writes one About photo, resized and stripped but not watermarked. Returns the line that shows it in about.md. */
export function processAboutImage({ source, name, destination, dryRun = false }) {
  if (!dryRun) {
    fs.mkdirSync(destination.dir, { recursive: true });
    magick([
      source + '[0]', '-auto-orient', '-resize', `${ABOUT_MAX_EDGE}x${ABOUT_MAX_EDGE}>`, '-strip',
      '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'sRGB',
      '-quality', String(ABOUT_QUALITY), path.join(destination.dir, `${name}.jpg`),
    ]);
  }
  return `![Describe the photo](${IMAGES_FOLDER}/${destination.relativeDir}/${name}.jpg)`;
}

function addAboutImages(options, root) {
  const destination = aboutDestination(root);
  const files = collectInputs(options.inputs);
  if (files.length === 0) fail('nothing to process');
  if (options.dryRun) console.log('Dry run: nothing will be written.');
  console.log(`Destination: ${destination.dir}`);

  const lines = [];
  let skipped = 0;
  for (const source of files) {
    const name = imageName(source);
    if (!name || lines.some((line) => line.endsWith(`/${name}.jpg)`)) || fs.existsSync(path.join(destination.dir, `${name}.jpg`))) {
      console.log(`Skipping ${path.basename(source)}: ${name ? `${destination.relativeDir}/${name}.jpg already exists` : 'name has no letters or numbers'}`);
      skipped++;
      continue;
    }
    lines.push(processAboutImage({ source, name, destination, dryRun: options.dryRun }));
    console.log(`${options.dryRun ? 'Would add' : 'Added'} ${destination.relativeDir}/${name}.jpg`);
  }
  if (lines.length > 0) {
    console.log(`\nPut these lines in about.md where each photo should show, then describe it in the [ ]:\n  ${lines.join('\n  ')}\n`);
  }
  console.log(`Done: ${lines.length} ${options.dryRun ? 'to add' : 'added'}, ${skipped} skipped.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root ? path.resolve(options.root) : REPO_ROOT;
  if (options.about) return addAboutImages(options, root);
  const settings = loadSite(root);
  checkCopies(options.copies, settings);
  const sale = saleFor(options);
  const destination = destinationFor({ year: options.year, project: options.project, repoRoot: root });
  const dataPath = options.data ? path.resolve(options.data) : defaultDataPath(root);
  const data = readData(dataPath);

  const files = collectInputs(options.inputs);
  if (files.length === 0) fail('nothing to process');

  if (options.dryRun) console.log('Dry run: nothing will be written.');
  console.log(`Destination: ${destination.dir}`);

  const workDir = makeWorkDir();
  const images = [];
  const seen = new Set();
  let skipped = 0;
  let failed = 0;
  try {
    for (const source of files) {
      const name = imageName(source);
      if (!name) {
        console.warn(`Skipping ${source}: name has no letters or numbers`);
        skipped++;
        continue;
      }
      if (seen.has(name) || fs.existsSync(path.join(destination.dir, `${name}.jpg`))) {
        console.log(`Skipping ${path.basename(source)}: ${destination.relativeDir}/${name}.jpg already exists`);
        skipped++;
        continue;
      }
      seen.add(name);

      try {
        const desc = options.project !== undefined ? '' : options.desc ?? '';
        const { image, id } = processImage({ source, name, destination, settings, workDir: workDir.dir, desc, dryRun: options.dryRun });
        images.push(sale ? { ...image, sale } : image);
        console.log(`${options.dryRun ? 'Would add' : 'Added'} ${destination.relativeDir}/${name}.jpg (${image.width}x${image.height}, ${id})`);
      } catch (error) {
        console.error(`Failed ${path.basename(source)}: ${error.message}`);
        failed++;
      }
    }
  } finally {
    workDir.cleanup();
  }

  if (images.length > 0) {
    const added = mergeIntoData(data, { year: options.year, project: options.project, desc: options.desc, images, featured: options.featured });
    if (!options.dryRun) writeData(dataPath, data);
    console.log(`${options.dryRun ? 'Would add' : 'Added'} ${added} entr${added === 1 ? 'y' : 'ies'} to ${dataPath}`);
  }

  console.log(`Done: ${images.length} ${options.dryRun ? 'to add' : 'added'}, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

// Run as a command only when started directly, so import.mjs can use the functions above
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
