#!/usr/bin/env node
/**
 * Makes this gallery's site icons (the little picture in the browser tab and on a phone's home screen)
 * from a few letters or from a square-ish picture:
 *
 *   node scripts/make-icons.mjs --text "K&L" [--bg "#9a4a2b"] [--fg "#fdfbf6"] [--font Georgia-Bold]
 *   node scripts/make-icons.mjs --image "C:\path\to\logo.png" [--bg "#ffffff"]
 *
 * Writes, under the gallery root:
 *   icons/favicon.ico            16, 32 and 48px, for browser tabs
 *   icons/apple-touch-icon.png   180px with a solid background, for phone home screens
 * The site build (craft-showcase's fetch-gallery) copies them to the site root; a gallery without
 * icons/ gets craft-showcase's default icons.
 *
 * Needs ImageMagick 7 (`magick`) on PATH, like add-images.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_SIZE = 512;
const TOUCH_SIZE = 180;

const USAGE = `Usage:
  node scripts/make-icons.mjs --text "<letters>" [--bg <color>] [--fg <color>] [--font <font>] [--root <gallery folder>]
  node scripts/make-icons.mjs --image <picture> [--bg <color>] [--root <gallery folder>]

  --text    1-3 letters drawn on a rounded square, e.g. "K&L"
  --image   a picture to use instead (cropped to a square from the middle)
  --bg      background color (default #9a4a2b, the site's terracotta)
  --fg      letter color for --text (default #fdfbf6, cream)
  --font    ImageMagick font name for --text (default Georgia-Bold; see: magick -list font)
  --root    gallery folder holding site.json (default: this repo)`;

function fail(message) {
  console.error(`make-icons: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { bg: '#9a4a2b', fg: '#fdfbf6', font: 'Georgia-Bold' };
  const valued = { '--text': 'text', '--image': 'image', '--bg': 'bg', '--fg': 'fg', '--font': 'font', '--root': 'root' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    const key = valued[arg];
    if (!key || argv[i + 1] === undefined) fail(`unknown or incomplete option ${arg}\n\n${USAGE}`);
    options[key] = argv[++i];
  }
  if (!options.text === !options.image) fail(`give either --text or --image\n\n${USAGE}`);
  if (options.text !== undefined && options.text.trim() === '') fail('--text needs some letters');
  return options;
}

function magick(args) {
  try {
    execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    fail(`ImageMagick failed: ${String(error.stderr ?? error.message).trim()}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root ? path.resolve(options.root) : REPO_ROOT;
  if (!fs.existsSync(path.join(root, 'site.json'))) fail(`${root} has no site.json; is it a gallery?`);
  if (options.image && !fs.existsSync(options.image)) fail(`${options.image} doesn't exist`);

  const outDir = path.join(root, 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'make-icons-'));
  const master = path.join(tmp, 'master.png');

  try {
    if (options.text) {
      // Letters fill most of a rounded square; label: sizes the text to the box
      const radius = Math.round(MASTER_SIZE * 0.19);
      const box = Math.round(MASTER_SIZE * 0.78);
      magick([
        '-size', `${MASTER_SIZE}x${MASTER_SIZE}`, 'xc:none',
        '-fill', options.bg, '-draw', `roundrectangle 0,0 ${MASTER_SIZE - 1},${MASTER_SIZE - 1} ${radius},${radius}`,
        '(', '-background', 'none', '-fill', options.fg, '-font', options.font, '-size', `${box}x${Math.round(box * 0.7)}`,
        '-gravity', 'center', `label:${options.text.replaceAll('%', '%%')}`, ')',
        '-gravity', 'center', '-composite', master,
      ]);
    } else {
      magick([
        options.image + '[0]', '-auto-orient', '-background', options.bg, '-alpha', 'remove', '-alpha', 'off',
        '-resize', `${MASTER_SIZE}x${MASTER_SIZE}^`, '-gravity', 'center', '-extent', `${MASTER_SIZE}x${MASTER_SIZE}`, master,
      ]);
    }

    magick([master, '-define', 'icon:auto-resize=48,32,16', path.join(outDir, 'favicon.ico')]);
    // Phones round the corners themselves and show transparency as black, so this one is a full square
    magick([
      '-size', `${MASTER_SIZE}x${MASTER_SIZE}`, `xc:${options.bg}`, master, '-composite',
      '-resize', `${TOUCH_SIZE}x${TOUCH_SIZE}`, '-strip', path.join(outDir, 'apple-touch-icon.png'),
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`Wrote ${path.join('icons', 'favicon.ico')} and ${path.join('icons', 'apple-touch-icon.png')} in ${root}`);
}

main();
