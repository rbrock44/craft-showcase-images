#!/usr/bin/env node
/**
 * Picture import for people who'd rather not use the command line: started by double-clicking
 * "Import Pictures.cmd". Reads the To_Import folder, makes the watermarked copies (via add-images.mjs),
 * lists them on the website, files the originals away under To_Import/Imported/, and offers to publish.
 *
 * Folder rules (inside To_Import):
 *   picture.jpg                       loose picture for the current year
 *   <Project Name>/picture.jpg        picture in that project, current year
 *   <YYYY>/picture.jpg                loose picture for that year
 *   <YYYY>/<Project Name>/picture.jpg picture in that project, that year
 *   <project folder>/description.txt  project description (when the project is new or has none)
 *   picture.txt next to picture.jpg   that picture's description
 *   Imported/                         where finished originals go; never read
 *
 * Usage:
 *   node scripts/import.mjs [--folder <path>] [--yes] [--no-publish]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPO_ROOT,
  checkMagick,
  defaultDataPath,
  destinationFor,
  imageName,
  isImageFile,
  loadSite,
  makeWorkDir,
  mergeIntoData,
  processImage,
  readData,
  slugify,
  writeData,
} from './add-images.mjs';

const IMPORTED_FOLDER = 'Imported';
// Repo paths, with forward slashes as git prints them
const IMAGES_FOLDER = 'images';
const DATA_FILE = 'project-list.json';

const USAGE = `Usage:
  node scripts/import.mjs [--folder <path>] [--yes] [--no-publish]

  --folder      folder to import from (default: Documents\\To_Import)
  --yes         don't ask before importing
  --no-publish  don't ask about publishing; leave it for next time`;

/** A problem to explain in plain words, with the technical detail shown underneath. */
class FriendlyError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

// ---------- small helpers ----------

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

function listInWords(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function parseArgs(argv) {
  const options = { yes: false, publish: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--no-publish') {
      options.publish = false;
    } else if (arg === '--folder') {
      if (i + 1 >= argv.length) throw new FriendlyError(`${arg} needs a value.\n\n${USAGE}`);
      options[arg.slice(2)] = argv[++i];
    } else {
      throw new FriendlyError(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

/** Documents\To_Import, also checking a OneDrive-backed Documents folder. */
function defaultFolder() {
  const home = os.homedir();
  const candidates = [path.join(home, 'Documents', 'To_Import')];
  if (process.env.OneDrive) candidates.push(path.join(process.env.OneDrive, 'Documents', 'To_Import'));
  candidates.push(path.join(home, 'OneDrive', 'Documents', 'To_Import'));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

/** Answers typed (or piped) into the window, one line per question. */
function createPrompter() {
  const lines = [];
  const waiting = [];
  let ended = false;
  let buffer = '';
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (waiting.length) waiting.shift()(line);
        else lines.push(line);
      }
    });
    process.stdin.on('end', () => {
      ended = true;
      if (buffer) lines.push(buffer);
      buffer = '';
      while (waiting.length) waiting.shift()(lines.length ? lines.shift() : null);
    });
  };
  const nextLine = () => {
    start();
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.resolve(null);
    process.stdin.resume();
    return new Promise((resolve) => waiting.push(resolve));
  };
  return {
    async yesNo(question) {
      for (;;) {
        process.stdout.write(`${question} (Y/N) `);
        const answer = await nextLine();
        if (answer === null) {
          console.log('');
          return false;
        }
        const clean = answer.trim().toLowerCase();
        if (clean === 'y' || clean === 'yes') return true;
        if (clean === 'n' || clean === 'no') return false;
        console.log('Please type Y for yes or N for no, then press Enter.');
      }
    },
    close() {
      process.stdin.pause();
    },
  };
}

// ---------- git ----------

function git(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') throw new FriendlyError('Git is not installed on this computer. Ask Ryan to run Setup.');
    const detail = `git ${args.join(' ')} (in ${repo})\n${(error.stderr || error.stdout || error.message).trim()}`;
    const wrapped = new Error(detail);
    wrapped.gitFailed = true;
    throw wrapped;
  }
}

/** Changed paths from `git status`, relative to the repo root with forward slashes. */
function changedPaths(repo) {
  const entries = git(repo, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2);
    paths.push(entries[i].slice(3));
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return paths;
}

/** Commits not yet pushed, or null when the branch has no upstream to compare with. */
function unpushedCount(repo) {
  try {
    return Number(git(repo, ['rev-list', '--count', '@{u}..HEAD']).trim());
  } catch {
    return null;
  }
}

function checkRepo(repo, label, isExpected) {
  if (!fs.existsSync(path.join(repo, '.git'))) {
    throw new FriendlyError(`Can't find the ${label} folder at ${repo}. Ask Ryan to run Setup.`);
  }
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'master') {
    throw new FriendlyError(
      `The ${label} folder is not set up the usual way, so nothing was changed. Ask Ryan to take a look.`,
      `${repo} is on branch "${branch}", expected "master".`,
    );
  }
  const unexpected = changedPaths(repo).filter((file) => !isExpected(file));
  if (unexpected.length > 0) {
    throw new FriendlyError(
      `The ${label} folder has changes this program didn't make, so nothing was changed. Ask Ryan to take a look.`,
      `Unexpected changes in ${repo}:\n  ${unexpected.join('\n  ')}`,
    );
  }
}

/** Brings a repo up to date when it has nothing pending; a failure (e.g. offline) only warns. */
function refreshRepo(repo, label) {
  if (changedPaths(repo).length > 0 || unpushedCount(repo) === null) return;
  try {
    git(repo, ['pull', '--rebase', '--quiet']);
  } catch (error) {
    console.log(`(Couldn't get the latest ${label} from the internet. Carrying on with what's here.)`);
    console.log(`  ${error.message.split('\n').join('\n  ')}`);
  }
}

function commitIfChanged(repo, paths, message) {
  git(repo, ['add', '-A', '--', ...paths]);
  const staged = git(repo, ['diff', '--cached', '--name-only', '--', ...paths]).trim();
  if (!staged) return false;
  git(repo, ['commit', '--quiet', '-m', message, '--', ...paths]);
  return true;
}

/** Pulls (rebasing local commits on top) then pushes. Returns an error message, or null when it worked. */
function pushRepo(repo) {
  try {
    if (unpushedCount(repo) === null) {
      git(repo, ['push', '--quiet', '-u', 'origin', 'HEAD']);
      return null;
    }
    try {
      git(repo, ['pull', '--rebase', '--quiet']);
    } catch (error) {
      try {
        git(repo, ['rebase', '--abort']);
      } catch {
        // nothing to abort
      }
      throw error;
    }
    if (unpushedCount(repo) > 0) git(repo, ['push', '--quiet']);
    return null;
  } catch (error) {
    return error.message;
  }
}

// ---------- reading the To_Import folder ----------

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim();
}

function isYearFolder(name) {
  return /^\d{4}$/.test(name) && Number(name) >= 1900 && Number(name) <= 2100;
}

/**
 * Looks through one folder of pictures (the main folder, a year folder or a project folder).
 * Returns the pictures with their descriptions, the description.txt if any, and notes on
 * anything left alone.
 */
function scanPictureFolder(folder, relative, { allowDescription, allowSubfolders }) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const textFiles = new Map(files.filter((name) => name.toLowerCase().endsWith('.txt')).map((name) => [name.toLowerCase(), name]));
  const usedText = new Set();
  const pictures = [];
  const notes = [];
  let descriptionFile = null;

  for (const name of files.filter(isImageFile).sort((a, b) => a.localeCompare(b))) {
    const base = path.parse(name).name.toLowerCase();
    const textName = textFiles.get(`${base}.txt`) ?? textFiles.get(`${name.toLowerCase()}.txt`);
    let desc = '';
    if (textName) {
      usedText.add(textName.toLowerCase());
      desc = readText(path.join(folder, textName));
    }
    pictures.push({
      source: path.join(folder, name),
      relative: path.join(relative, name),
      textFile: textName ? path.join(folder, textName) : null,
      textRelative: textName ? path.join(relative, textName) : null,
      desc,
    });
  }

  const descriptionName = textFiles.get('description.txt');
  if (descriptionName && allowDescription) {
    usedText.add('description.txt');
    descriptionFile = { source: path.join(folder, descriptionName), relative: path.join(relative, descriptionName) };
  }

  const where = relative ? ` in "${relative}"` : '';
  for (const name of files) {
    if (isImageFile(name) || usedText.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === 'description.txt') {
      notes.push(`"${name}"${where} was left alone: a description only works inside a project folder.`);
    } else if (name.toLowerCase().endsWith('.txt')) {
      notes.push(`"${name}"${where} was left alone: there's no picture with the same name.`);
    } else if (!['desktop.ini', 'thumbs.db', '.ds_store'].includes(name.toLowerCase())) {
      notes.push(`"${name}"${where} was left alone: it isn't a picture (only .jpg, .jpeg and .png are used).`);
    }
  }
  if (!allowSubfolders) {
    for (const entry of entries.filter((item) => item.isDirectory())) {
      notes.push(`The folder "${path.join(relative, entry.name)}" was left alone: folders inside a project aren't used.`);
    }
  }
  return { pictures, descriptionFile, notes };
}

/** Everything in the To_Import folder, grouped by where it will go on the website. */
function scanImportFolder(folder, currentYear) {
  const groups = [];
  const notes = [];
  const addGroup = (year, project, scan) => {
    notes.push(...scan.notes);
    if (scan.pictures.length === 0) {
      if (project !== null) notes.push(`The project folder "${project}" has no pictures in it.`);
      return;
    }
    const projectDesc = scan.descriptionFile ? readText(scan.descriptionFile.source) : '';
    groups.push({ year, project, projectDesc, descriptionFile: scan.descriptionFile, pictures: scan.pictures });
  };

  const top = scanPictureFolder(folder, '', { allowDescription: false, allowSubfolders: true });
  addGroup(currentYear, null, top);

  const folders = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== IMPORTED_FOLDER.toLowerCase())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const name of folders) {
    const full = path.join(folder, name);
    if (isYearFolder(name)) {
      const yearScan = scanPictureFolder(full, name, { allowDescription: false, allowSubfolders: true });
      addGroup(name, null, yearScan);
      const projects = fs
        .readdirSync(full, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      for (const project of projects) {
        if (!slugify(project)) {
          notes.push(`The folder "${path.join(name, project)}" was left alone: its name needs some letters or numbers.`);
          continue;
        }
        const projectScan = scanPictureFolder(path.join(full, project), path.join(name, project), { allowDescription: true, allowSubfolders: false });
        addGroup(name, project, projectScan);
      }
    } else if (!slugify(name)) {
      notes.push(`The folder "${name}" was left alone: its name needs some letters or numbers.`);
    } else {
      const projectScan = scanPictureFolder(full, name, { allowDescription: true, allowSubfolders: false });
      addGroup(currentYear, name, projectScan);
    }
  }
  return { groups, notes };
}

/** Works out each picture's published name and whether it's new, already published, or clashing. */
function planGroups(groups, repoRoot) {
  for (const group of groups) {
    group.destination = destinationFor({ year: group.year, project: group.project, repoRoot });
    const seen = new Map();
    for (const picture of group.pictures) {
      picture.name = imageName(picture.source);
      const file = path.basename(picture.source);
      if (!picture.name) {
        picture.status = 'bad-name';
        picture.note = `"${picture.relative}" was left alone: its name needs some letters or numbers. Rename it and run this again.`;
      } else if (seen.has(picture.name)) {
        picture.status = 'clash';
        picture.note = `"${picture.relative}" was left alone: it has the same name as "${seen.get(picture.name)}". Rename one of them and run this again.`;
      } else if (fs.existsSync(path.join(group.destination.dir, `${picture.name}.jpg`))) {
        picture.status = 'exists';
        picture.note = `"${picture.relative}" is already on the website, so it will be skipped.`;
        seen.set(picture.name, file);
      } else {
        picture.status = 'new';
        seen.set(picture.name, file);
      }
    }
  }
}

function describeGroup(group, count) {
  const pictures = plural(count, 'picture');
  return group.project === null ? `${plural(count, 'loose picture')} for ${group.year}` : `${pictures} for the project '${group.project}' (${group.year})`;
}

// ---------- moving originals ----------

function timestampFolderName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function moveOriginals(folder, relativePaths) {
  const base = path.join(folder, IMPORTED_FOLDER);
  let target = path.join(base, timestampFolderName());
  for (let n = 2; fs.existsSync(target); n++) target = path.join(base, `${timestampFolderName()} (${n})`);
  for (const relative of relativePaths) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(path.join(folder, relative), destination);
  }
  removeEmptyFolders(folder, true);
  return target;
}

function removeEmptyFolders(folder, isRoot = false) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || (isRoot && entry.name.toLowerCase() === IMPORTED_FOLDER.toLowerCase())) continue;
    const child = path.join(folder, entry.name);
    removeEmptyFolders(child);
    if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
  }
}

// ---------- publishing ----------

/** The paths import.mjs is allowed to leave changed between runs. */
function isGalleryFile(file) {
  return file.startsWith(`${IMAGES_FOLDER}/`) || file === DATA_FILE;
}

function hasPending(repo) {
  return changedPaths(repo).some(isGalleryFile) || (unpushedCount(repo) ?? 0) > 0;
}

function publish({ repo, siteUrl }) {
  console.log('');
  console.log('Publishing...');
  const paths = [IMAGES_FOLDER, DATA_FILE];
  git(repo, ['add', '-A', '--', ...paths]);
  const added = git(repo, ['diff', '--cached', '--name-only', '--diff-filter=A', '--', IMAGES_FOLDER])
    .split('\n')
    .filter((file) => file.toLowerCase().endsWith('.jpg')).length;
  const message = added > 0 ? `add ${plural(added, 'picture')}` : 'update pictures';

  console.log('  Saving the pictures...');
  commitIfChanged(repo, paths, message);

  console.log('  Uploading...');
  const pushError = pushRepo(repo);
  if (pushError) {
    console.log('');
    console.log("Couldn't upload the pictures. Check the internet connection and run this again;");
    console.log('everything is saved and will upload next time.');
    console.log('');
    console.log(`Technical details:\n  ${pushError.split('\n').join('\n  ')}`);
    return false;
  }
  console.log('');
  console.log(`Done! The website updates in a few minutes: ${siteUrl ?? '(no url in site.json)'}`);
  return true;
}

// ---------- main ----------

async function run(prompt) {
  const options = parseArgs(process.argv.slice(2));

  const settings = loadSite(REPO_ROOT);
  const siteName = settings.title ?? settings.watermarkText;
  const repo = REPO_ROOT;
  const dataPath = defaultDataPath(REPO_ROOT);
  const folder = path.resolve(options.folder ?? defaultFolder());

  console.log(`${siteName}: add pictures`);
  console.log('');

  try {
    checkMagick();
  } catch (error) {
    throw new FriendlyError('ImageMagick (the picture tool) is missing. Ask Ryan to run Setup.', error.message);
  }

  checkRepo(repo, 'pictures', isGalleryFile);
  refreshRepo(repo, 'pictures');

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    console.log(`Made the folder ${folder}`);
  }

  const currentYear = String(new Date().getFullYear());
  const { groups, notes } = scanImportFolder(folder, currentYear);
  planGroups(groups, REPO_ROOT);

  const newCount = (group) => group.pictures.filter((picture) => picture.status === 'new').length;
  const toImport = groups.filter((group) => newCount(group) > 0);
  const pictureNotes = groups.flatMap((group) => group.pictures.filter((picture) => picture.note).map((picture) => picture.note));
  const allNotes = [...pictureNotes, ...notes];

  if (toImport.length === 0) {
    console.log(`No new pictures in ${folder}`);
    for (const note of allNotes) console.log(`  - ${note}`);
  } else {
    console.log(`Found ${listInWords(toImport.map((group) => describeGroup(group, newCount(group))))}.`);
    const described = [];
    for (const group of toImport) {
      if (group.project !== null && group.projectDesc) described.push(`the project '${group.project}'`);
      for (const picture of group.pictures) {
        if (picture.status === 'new' && picture.desc) described.push(path.basename(picture.source));
      }
    }
    if (described.length > 0) console.log(`  - With a description: ${listInWords(described)}.`);
    for (const note of allNotes) console.log(`  - ${note}`);
    console.log('');
    const go = options.yes || (await prompt.yesNo('Go ahead?'));
    if (!go) {
      console.log('OK, nothing was changed.');
      return 0;
    }

    console.log('');
    const total = toImport.reduce((sum, group) => sum + newCount(group), 0);
    const created = [];
    const results = [];
    const workDir = makeWorkDir();
    let done = 0;
    try {
      for (const group of toImport) {
        const images = [];
        for (const picture of group.pictures.filter((item) => item.status === 'new')) {
          done++;
          console.log(`Working on picture ${done} of ${total}: ${picture.relative}`);
          try {
            const { image, files } = processImage({
              source: picture.source,
              name: picture.name,
              destination: group.destination,
              settings,
              workDir: workDir.dir,
              desc: picture.desc,
            });
            created.push(...files);
            images.push(image);
          } catch (error) {
            throw new FriendlyError(
              `Something went wrong with "${picture.relative}". Nothing was imported and your pictures are still in ${folder}.\n` +
                "If the picture opens fine on the computer, take a photo of this window and send it to Ryan.",
              error.message,
            );
          }
        }
        results.push({ group, images });
      }

      const data = readData(dataPath);
      for (const { group, images } of results) {
        mergeIntoData(data, { year: group.year, project: group.project, desc: group.projectDesc, images });
      }
      writeData(dataPath, data);
    } catch (error) {
      for (const file of created) fs.rmSync(file, { force: true });
      for (const group of toImport) {
        if (fs.existsSync(group.destination.dir) && fs.readdirSync(group.destination.dir).length === 0) {
          fs.rmdirSync(group.destination.dir);
          const yearDir = path.dirname(group.destination.dir);
          if (group.project !== null && fs.existsSync(yearDir) && fs.readdirSync(yearDir).length === 0) fs.rmdirSync(yearDir);
        }
      }
      throw error;
    } finally {
      workDir.cleanup();
    }

    // Everything worked: file the originals (and their text files) away
    const toMove = [];
    for (const group of groups) {
      const moved = group.pictures.filter((picture) => picture.status === 'new' || picture.status === 'exists');
      for (const picture of moved) {
        toMove.push(picture.relative);
        if (picture.textRelative) toMove.push(picture.textRelative);
      }
      if (group.descriptionFile && moved.length > 0) toMove.push(group.descriptionFile.relative);
    }
    const importedTo = moveOriginals(folder, toMove);
    console.log('');
    console.log(`Imported ${plural(total, 'picture')}. The originals were moved to:`);
    console.log(`  ${importedTo}`);
  }

  if (!hasPending(repo)) return 0;
  console.log('');
  if (!options.publish) {
    console.log('The pictures are ready and will go on the website the next time you publish.');
    return 0;
  }
  const publishNow = await prompt.yesNo('Publish to the website now?');
  if (!publishNow) {
    console.log('OK. The pictures are ready and will go on the website the next time you publish.');
    return 0;
  }
  return publish({ repo, siteUrl: settings.url }) ? 0 : 1;
}

const prompt = createPrompter();
try {
  process.exitCode = await run(prompt);
} catch (error) {
  console.log('');
  if (error instanceof FriendlyError) {
    console.log(error.message);
    if (error.detail) console.log(`\nTechnical details:\n  ${error.detail.split('\n').join('\n  ')}`);
  } else {
    console.log('Something went wrong. Take a photo of this window and send it to Ryan.');
    console.log(`\nTechnical details:\n  ${String(error.stack || error.message).split('\n').join('\n  ')}`);
  }
  process.exitCode = 1;
} finally {
  prompt.close();
}
