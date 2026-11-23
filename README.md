# Craft Showcase Images

> The public sample gallery behind [craft-showcase.ryan-brock.com](https://craft-showcase.ryan-brock.com), and the template to copy when making a gallery for someone new.

## 📚 Table of Contents

- [What's My Purpose?](#-whats-my-purpose)
- [How to Use](#-how-to-use)
  - [Folder Layout](#folder-layout)
  - [Double-Click Import](#double-click-import)
  - [Adding Images From the Command Line](#adding-images-from-the-command-line)
  - [Watermarks](#watermarks)
  - [Checking a Suspected Copy](#checking-a-suspected-copy)
  - [Deploying](#deploying)
  - [List of Scripts](#list-of-scripts)
  - [Making a Gallery for Someone New](#making-a-gallery-for-someone-new)
- [Technologies](#-technologies)
- [Getting Started (Local Setup)](#-getting-started-local-setup)
- [How to Contribute](#-how-to-contribute)

---

## 🎯 What's My Purpose?

This repo does two jobs:

- **The sample site's gallery.** Its "Sample" pictures (watermarked `© Craft Showcase`) are what [craft-showcase.ryan-brock.com](https://craft-showcase.ryan-brock.com) shows, to demonstrate what a Craft Showcase site looks like. This repo is **public**, so the sample site's Cloudflare build clones it with just `GALLERY_REPO` and no `GALLERY_TOKEN`.
- **The template for new galleries.** Every person with a Craft Showcase site gets their own **private** gallery repo copied from this one (see [Making a Gallery for Someone New](#making-a-gallery-for-someone-new)).

The site code lives in a separate private repo ([craft-showcase](https://github.com/rbrock44/craft-showcase)); its Cloudflare Pages build clones this gallery and serves the pictures itself from `/images/...`, using `site.json` for the site's settings and `project-list.json` for what to show.

The person adding pictures doesn't need a GitHub account or the command line: they drop pictures in a folder and double-click **Import Pictures** ([HOW-TO-ADD-PICTURES.md](HOW-TO-ADD-PICTURES.md)). Their PC pushes with a deploy key that only works for this repo.

Only processed, watermarked copies are ever published. Untouched originals stay on their PC.

---

## 🛠 How to Use

### Folder Layout

```
site.json                  site + watermark settings (the site build copies it to site.config.json)
project-list.json          the picture list the site reads
images/
├── 2026/
│   ├── sample-sketches/   a project (folder = project name slugified)
│   │   ├── owl.jpg        full copy (watermarked, long edge <= 1600px)
│   │   ├── owl-mid.webp   fits 1200x1200
│   │   └── owl-thumb.webp 400px wide
│   └── loose-sketch.jpg   loose picture for the year, not in any project
└── 2025/
scripts/                   add-images.mjs, import.mjs, reveal-watermark.mjs, setup.ps1
Import Pictures.cmd        double-click import
Setup.cmd                  one-time PC setup
.github/workflows/deploy.yml
```

`site.json`:

```json
{
  "title": "Craft Showcase",
  "url": "https://craft-showcase.ryan-brock.com",
  "description": "A sample gallery showing what a Craft Showcase site looks like.",
  "projectNoun": "project",
  "photoNoun": "piece",
  "directoryUrl": null,
  "featured": "above",
  "watermarkText": "Craft Showcase",
  "idPrefix": "CS",
  "repo": "rbrock44/craft-showcase-images"
}
```

- `title`, `url`, `description`, `projectNoun`, `photoNoun`, `directoryUrl` - used by the site
- `featured` - the home page's Featured group: `"above"` or `"below"` Favorites, or `"off"` to hide it (missing means `"above"`). It only shows when something is featured
- `watermarkText` - the text stamped on every picture
- `idPrefix` - start of each picture's hidden id (`CS-1a2b3c4d`)
- `repo` - this repo; `setup.ps1` names the deploy key, ssh alias and clone folder after it
- `shop` - selling copies and originals, off by default; see [Shop (Selling Work)](#shop-selling-work)

Each picture entry in `project-list.json` is `{ name, desc, url, width, height }`, with `url` root-relative (`/images/2026/sample-sketches/owl.jpg`) and width/height the published `.jpg`'s size. A project, or a loose picture, with `"featured": true` is also listed in the site's Featured group; set it with `add-images.mjs --featured` or by hand.

### Shop (Selling Work)

Off until `site.json`'s `shop.enabled` is `true`; with it off (or no `shop` at all) the site shows no prices anywhere. The site build (`craft-showcase`'s `fetch-gallery`) checks the shop settings and every picture's `sale` either way and stops with a message naming the picture on any mistake, like an unknown preset or an original with no price.

**Prices are whole dollars** (in `currency`, default `USD`), not cents: `25` is $25, `12.5` is $12.50.

`site.json`'s `shop`:

```json
"shop": {
  "enabled": false,
  "currency": "USD",
  "orderEmail": "",
  "variants": {
    "print-5x7": { "name": "5x7 print", "price": 15 },
    "print-8x10": { "name": "8x10 print", "price": 25, "checkoutUrl": "" },
    "print-11x14": { "name": "11x14 print", "price": 40 },
    "canvas-16x20": { "name": "16x20 canvas", "price": 120 },
    "card-pack-5": { "name": "Pack of 5 cards", "price": 12 }
  },
  "presets": {
    "standard": ["print-5x7", "print-8x10"],
    "large": ["print-11x14", "canvas-16x20"],
    "cards": ["card-pack-5"]
  },
  "defaultPreset": "standard"
}
```

- `variants` - every kind of copy that can be ordered, by id, each with its standard price. Ids are lowercase letters, numbers and dashes; keep them stable (payment links get matched to them later). `original` is reserved
- `presets` - named lists of variant ids, so a picture can say `"large"` instead of listing variants. A preset name can't also be a variant id
- `defaultPreset` - what a picture offers when it says nothing about copies (missing: every variant)
- `orderEmail` - optional; when set each option gets an **Ask to order** email link prefilled with the site, the picture, its year and project, and the option. Without it the site shows the prices and "Ordering coming soon"
- `checkoutUrl` - optional payment link (e.g. a Stripe Payment Link) on a variant or an original; when set the option shows **Buy** and links there, with `?client_reference_id=<year>_<project-slug>_<name>` added so the payment says which picture. Empty means none

A picture's optional `sale` in `project-list.json` (project pictures and loose pictures alike):

```json
"sale": {
  "original": { "price": 300, "sold": false, "checkoutUrl": "" },
  "copies": ["cards", "print-8x10", { "id": "sticker-3in", "name": "3 inch sticker", "price": 4 }],
  "copyPrices": { "print-8x10": 30 }
}
```

- `original` - the one of a kind piece, always priced per picture by the artist (there is no site-wide original price); leave it out when it's not for sale. `"sold": true` keeps it listed as Sold, with its price, and no way to order it
- `copies` - missing or `true`: the default preset. `false`: no copies. A preset name: `"large"`. Or a list mixing preset names, variant ids and one-off variants (`{ id, name, price, checkoutUrl? }`) only this picture has; a repeated id counts once, where it's first listed
- `copyPrices` - this picture's price for a variant by id, instead of the standard one. A variant's `checkoutUrl` isn't used when its price is overridden here, since that link charges the standard price
- A picture with no `sale` offers the default preset's copies once the shop is on

The sample data has one of each: `sample-bold-wide` (original $300 for sale, default copies), `sample-outline-tall` (original $225 sold, `"large"` copies) and `sample-stamp` (a preset, a variant id and a one-off sticker, with the 8x10 at $30).

### Double-Click Import

For the person adding pictures: put them in `Documents\To_Import`, double-click **Import Pictures**, answer Y/N. Step-by-step guide: [HOW-TO-ADD-PICTURES.md](HOW-TO-ADD-PICTURES.md).

- Pictures straight in `To_Import` are loose pictures for the current year
- `To_Import\<Project Name>\` is a project in the current year
- `To_Import\<YYYY>\` holds loose pictures for that year; `To_Import\<YYYY>\<Project Name>\` is a project in that year
- `description.txt` in a project folder sets the project's desc (only when new or empty); `<picture>.txt` sets that picture's desc
- Every picture is processed first. Only when all of them work are the originals moved to `To_Import\Imported\<YYYY-MM-DD HH-MM>\`; on any failure the files it wrote are removed and nothing is moved
- Publishing commits `images/` and `project-list.json` together as `add N pictures`, then pulls (rebase) and pushes. A failed push leaves the commit in place; the next run pushes it
- Stops before doing anything if the repo isn't on `master` or has changes outside `images/` and `project-list.json`

### Adding Images From the Command Line

1. Keep the originals somewhere outside this repo
2. Run [add-images](#add-imagesmjs) for each project (or for the year's loose pictures)
   - `node scripts/add-images.mjs --year 2025 --project "Barn Owl" --desc "Pencil study of a barn owl" "C:\Users\rbroc\Downloads\Owl"`
3. Check the new entries in `project-list.json` (add `desc`/`cover` text if wanted)
4. Commit and push; the [deploy](#deploying) rebuilds the site

### Watermarks

Every full copy gets three layers, all sized from the picture's short edge (or half the long edge, for very narrow pictures) so they scale with it:

| Layer | What | Strength |
|---|---|---|
| Visible | `© Craft Showcase` in the bottom right corner | white at 60% with a thin dark outline |
| Tiled | `© Craft Showcase` repeated diagonally across the whole picture | 6% gray, so cropping can't remove it |
| Hidden | 3-5 small copies of `Craft Showcase <id>` | 2% gray, effectively invisible |

- `<id>` is `idPrefix` + the first 8 hex characters of the SHA-256 of the original file, so each original has its own id and it can be matched back to the original later
- The hidden copies sit in the clear bands between rows of the tiled text, at spots picked by a generator seeded with the id, so re-running gives the same result
- The id is also written into the JPEG comment (`© Craft Showcase CS-1a2b3c4d`), though anyone re-saving the picture will likely lose that

**Why 1600px and quality 80?** The published copy looks good on a screen but is deliberately not print quality, so anyone wanting a print orders one instead of printing the download. Pictures smaller than 1600px are never upscaled.

### Checking a Suspected Copy

```bash
node scripts/reveal-watermark.mjs suspect.jpg
```

Writes `suspect-revealed.png` next to it: the paper is flattened to white and the faint marks are stretched to black. Look for small horizontal lines reading `Craft Showcase CS-xxxxxxxx` (3-5 of them); `CS-xxxxxxxx` is the id. Find the original whose SHA-256 starts with those 8 characters:

```powershell
Get-FileHash .\original.jpg -Algorithm SHA256
```

The marks survive JPEG re-saves and modest resizing. Heavy cropping can cut some of them off, which is why there are several.

### Deploying

`.github/workflows/deploy.yml` runs on every push to `master` and POSTs to the Cloudflare Pages deploy hook stored in the repo secret `CLOUDFLARE_DEPLOY_HOOK`. Cloudflare then builds craft-showcase, which clones this gallery. Without the secret the workflow skips with a notice.

### List of Scripts

#### add-images.mjs
- Makes the three published files for each input picture and lists them in `project-list.json`
  - Inputs: `.jpg` / `.jpeg` / `.png` files, or folders (every such file in it, not recursive)
  - Picture name = original file name slugified (`Barn Owl 1.JPG` -> `barn-owl-1`)
  - Destination: `images/<year>/<project-slug>/` with `--project`, else `images/<year>/`
  - Skips any picture whose name already exists in the destination
  - Creates the year and project in the JSON when missing; never removes, reorders or overwrites existing entries, `desc` or `cover` (an empty project `desc` can be filled)
- Also a module: import.mjs uses its exported functions
- Options

  | Option | Meaning |
  |---|---|
  | `--year <yyyy>` | year (required) |
  | `--project "<name>"` | project name; leave off for loose pictures |
  | `--desc "<text>"` | desc of a new project, or of each loose picture |
  | `--featured` | mark the project, or each loose picture added, `"featured": true` (shown in the site's Featured group); never unmarks |
  | `--original-price <dollars>` | put each new picture's original up for sale at this price (`"sale": { "original": { "price": 300, "sold": false } }`) |
  | `--copies <list>` | each new picture's `sale.copies`: a preset (`large`), comma-separated presets / variant ids (`cards,print-8x10`), or `none`; checked against `site.json`'s shop |
  | `--root <folder>` | gallery folder with `site.json`, `project-list.json`, `images/` (default: this repo) |
  | `--data <path>` | JSON file to update instead of `<root>/project-list.json` |
  | `--dry-run` | print what would happen, write nothing |

- EXAMPLE(S):
  - `node scripts/add-images.mjs --year 2025 --project "Barn Owl" --desc "Pencil study" "C:\Users\rbroc\Downloads\Owl"`
  - `node scripts/add-images.mjs --year 2025 "C:\Users\rbroc\Downloads\sketch.jpg"`
  - `node scripts/add-images.mjs --root ..\other-gallery-images --year 2025 "C:\Users\rbroc\Downloads\Samples"`
  - `node scripts/add-images.mjs --year 2025 --project "Barn Owl" --featured "C:\Users\rbroc\Downloads\Owl"`
  - `node scripts/add-images.mjs --year 2025 --project "Barn Owl" --original-price 250 --copies large "C:\Users\rbroc\Downloads\Owl"`

#### import.mjs
- The [double-click import](#double-click-import), run by `Import Pictures.cmd`
- Options: `--folder <path>` (default `Documents\To_Import`), `--yes` (don't ask before importing), `--no-publish` (don't ask about publishing)
- EXAMPLE(S):
  - `node scripts/import.mjs`
  - `node scripts/import.mjs --folder "C:\Users\rbroc\Downloads\New Drawings" --no-publish`

#### setup.ps1
- One-time setup of the picture-adder's Windows PC, run by `Setup.cmd`; safe to re-run
  - Installs Node.js LTS, ImageMagick and Git with winget when missing
  - Makes `~\.ssh\<repo-name>_deploy` (ed25519, no passphrase) and a `~\.ssh\config` alias `github-<repo-name>` that uses it
  - Checks the key works with `git ls-remote`; if not, prints the public key with instructions for Ryan and stops (exit code 2)
  - Clones through the alias into `Documents\<repo-name>`, sets a repo-local Git name/email (`<title> import`) when none is set globally, creates `Documents\To_Import` and an "Import Pictures" Desktop shortcut
- `-WhatIf` shows what it would do and changes nothing; `-SshDir`, `-DocumentsDir`, `-DesktopDir`, `-RemoteUrl` point it elsewhere for testing
- EXAMPLE(S):
  - Double-click `Setup.cmd`
  - `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -WhatIf`

#### reveal-watermark.mjs
- Makes a high-contrast copy of a picture so the hidden id marks show; also prints the JPEG comment if it's still there
- EXAMPLE(S):
  - `node scripts/reveal-watermark.mjs suspect.jpg`
  - `node scripts/reveal-watermark.mjs suspect.jpg revealed.png`

### Making a Gallery for Someone New

This repo is the template: start every new gallery from it.

1. Copy this repo into a new folder **without** `images/` and `.git/`, and with `project-list.json` emptied to `{"projectsByYear": []}`
2. Edit `site.json`: `title`, `url`, `description`, nouns, `watermarkText`, `idPrefix`, and `repo` (e.g. `rbrock44/<name>-images`)
3. Rewrite the README's title, blurb and purpose for that person's site (it's their gallery, not the sample), swap the names in `HOW-TO-ADD-PICTURES.md` and `.github/copilot-instructions.md`, then `git init -b master`, commit, and push to a new **private** GitHub repo with that name
4. On their PC, copy the folder over (USB or zip) and double-click `Setup.cmd`. It prints a public key; add it under the new repo's **Settings → Deploy keys → Add deploy key**, tick **Allow write access**, then have them run `Setup.cmd` again
5. In Cloudflare, create a Pages project from `craft-showcase` with environment variables:
   - `GALLERY_REPO` - the new repo (`rbrock44/<name>-images`)
   - `GALLERY_TOKEN` - a fine-grained GitHub token with read-only Contents access to that repo
6. Add the custom domain (`<name>.ryan-brock.com`) to the Pages project
7. In the Pages project's settings, create a deploy hook and save its URL in the new repo as the Actions secret `CLOUDFLARE_DEPLOY_HOOK`

---

## 🧰 Technologies

- Node.js (plain `.mjs`, no npm packages)
- ImageMagick 7
- Git, with an SSH deploy key on the picture-adder's PC
- PowerShell and batch files (setup and launchers)
- GitHub Actions + Cloudflare Pages deploy hook

---

## 🚀 Getting Started (Local Setup)

* Install [Node.js](https://nodejs.org/) (v24)
* Install [ImageMagick 7](https://imagemagick.org/script/download.php#windows) and make sure `magick` is on PATH
* Clone this repo
* Run the scripts from PowerShell or Git Bash, from the repo root
* Setting up the picture-adder's PC: see [First-Time Setup](HOW-TO-ADD-PICTURES.md#-first-time-setup-ryan-does-this)

---

## 🤝 How to Contribute

Found a typo or a small, obvious fix? Open a PR directly.
Want to change behavior or add something bigger? Open an issue first so we can talk it through before you put in the work.
