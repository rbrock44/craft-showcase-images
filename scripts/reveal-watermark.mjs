#!/usr/bin/env node
/**
 * Makes a high-contrast copy of an image so the nearly invisible id marks from add-images.mjs show up.
 * Use it on a suspected copy to read which original it came from.
 *
 * Usage:
 *   node scripts/reveal-watermark.mjs <file> [out]
 *
 * out defaults to <file name>-revealed.png next to the input. The id marks read
 * "<watermarkText> <idPrefix>-xxxxxxxx" (e.g. "K&L Crafts KL-1a2b3c4d") and appear as dark text in 3-5 spots;
 * the faint tiled "© <watermarkText>" pattern shows up too. The JPEG comment (if it survived) is printed as well.
 *
 * Requires ImageMagick 7 (magick) on PATH.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || input === '--help' || input === '-h') {
  console.log('Usage: node scripts/reveal-watermark.mjs <file> [out]');
  process.exit(input ? 0 : 1);
}
if (!fs.existsSync(input)) {
  console.error(`Error: not found: ${input}`);
  process.exit(1);
}

const parsed = path.parse(input);
const out = output ?? path.join(parsed.dir, `${parsed.name}-revealed.png`);

function magick(args) {
  try {
    return execFileSync('magick', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('Error: ImageMagick (magick) is not installed or not on PATH');
      process.exit(1);
    }
    throw new Error(error.stderr || error.message);
  }
}

const [width, height] = magick([input + '[0]', '-format', '%w %h', 'info:']).trim().split(/\s+/).map(Number);
const shortEdge = Math.min(width, height);
// Background estimate: a morphological close wipes out thin dark strokes (marks, text, pencil lines)
// and leaves the paper, so subtracting it isolates every stroke without halos around the drawing
const closeRadius = Math.max(4, Math.round(shortEdge * 0.008));
// Light smoothing knocks down JPEG noise so the faint text edges stand out
const smooth = Math.max(0.6, shortEdge / 1600);

magick([
  input + '[0]', '-colorspace', 'Gray',
  '(', '+clone', '-morphology', 'Close', `Octagon:${closeRadius}`, ')',
  // image - background, centred on mid-gray
  '+swap', '-compose', 'Mathematics', '-define', 'compose:args=0,1,-1,0.5', '-composite',
  '-blur', `0x${smooth}`,
  // Stretch the few gray levels just under mid-gray to the full range
  '-level', '48.6%,50%',
  out,
]);

const comment = magick([input + '[0]', '-format', '%c', 'info:']).trim();
console.log(`Revealed copy: ${out}`);
console.log(comment ? `JPEG comment: ${comment}` : 'JPEG comment: none (stripped)');
