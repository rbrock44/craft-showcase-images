# Craft Showcase Images

Public gallery repo for the Craft Showcase sample site (craft-showcase.ryan-brock.com), and the
template every new person's gallery repo is copied from (see README "Making a Gallery for Someone
New"). The site code is the private repo `craft-showcase`; its Cloudflare Pages build clones this
repo (`GALLERY_REPO`; no `GALLERY_TOKEN` needed since this repo is public), copies `site.json` to
its `site.config.json`, reads `project-list.json`, and serves the pictures itself from `/images/...`.
Galleries copied from it for real people are private and do need `GALLERY_TOKEN`.

Keep the scripts, launchers and workflow here in step with the other gallery repos copied
from it: a fix made in one belongs in all of them.

## Layout

- `site.json` - site + watermark settings: `title`, `url`, `description`, `projectNoun`,
  `photoNoun`, `directoryUrl`, `featured` (`"above"`/`"below"`/`"off"`: where the Featured group sits relative to Favorites; missing means `"above"`), `watermarkText`, `idPrefix`, `repo` (`rbrock44/craft-showcase-images`)
- `project-list.json` - the picture list; image urls are root-relative `/images/<year>/[<slug>/]<name>.jpg`
- `about.md` (optional) - the artist's About text in Markdown, photos as `![alt](images/about/<name>.jpg)`. The site build turns it into the About panel (raw HTML dropped, links only http(s)/mailto/site paths); no file hides the info button
- `icons/favicon.ico`, `icons/apple-touch-icon.png` - the site's own icons, made by `scripts/make-icons.mjs` (`--text` or `--image`); craft-showcase's fetch-gallery copies them to the site root, else uses its defaults
- `images/about/<name>.jpg` - About photos only: one file each, long edge <= 1200px, metadata stripped, q82, **not** watermarked, not in `project-list.json`; written by `add-images.mjs --about`
- `images/<year>/<project-slug>/<name>.jpg|-mid.webp|-thumb.webp` - a project's pictures
- `images/<year>/<name>.jpg|...` - loose pictures for that year, not in a project; in `project-list.json` each one's optional `after` names the project it's listed after on the site (none: before every project). `add-images.mjs` sets it to the year's newest project when the picture is added
- `site.json` `social` (optional): `facebook`, `instagram`, `twitter` (https urls) and `email`; the site shows an icon for each non-blank one and drops anything that isn't https or an email
- `site.json` `shop` (off unless `enabled: true`): `currency`, optional `orderEmail`, `variants` (copy kinds by id, each `{ name, price, checkoutUrl? }`), `presets` (named lists of variant ids), `defaultPreset`. A picture's optional `sale`: `original` (`{ price, sold?, checkoutUrl? }`, always priced per picture), `copies` (missing/`true` = default preset, `false`, a preset name, or a list of preset names, variant ids and one-off `{ id, name, price }` variants), `copyPrices` (price overrides by variant id). Prices are whole currency units (`25` = $25), not cents. The site build validates all of it and fails naming the picture; full shape in README "Shop (Selling Work)". `add-images.mjs --original-price`/`--copies` set `sale` on new pictures only; the double-click import doesn't
- `shop.preview` (true only on the sample: a visitor switch for example prices, nothing buyable), `shop.apiUrl` (https backend: cart checkout POST `<apiUrl>/checkout` with `items`, original availability GET `<apiUrl>/availability`) and `shop.publishableKey` (browser-safe only). Never put secret keys or tokens in `site.json`: it is published; they go in the backend Worker's secrets, and fetch-gallery stops on them
- `"featured": true` on a project or a loose picture lists it in the site's Featured group too; `add-images.mjs --featured` sets it (never unsets), the double-click import doesn't
- `scripts/add-images.mjs` - picture processing + JSON update; a CLI and a module of exported functions
- `scripts/import.mjs` - double-click import from `Documents/To_Import` (run by `Import Pictures.cmd`);
  imports add-images.mjs's functions, never shells out to it
- `scripts/setup.ps1` - one-time Windows PC setup with an SSH deploy key (run by `Setup.cmd`)
- The root `.cmd` launchers work double-clicked or from a prompt: they `pause` only when
  double-clicked (found by their name in `%cmdcmdline%`) and exit with the script's exit code
- `scripts/reveal-watermark.mjs` - contrast-stretched copy to read the hidden id marks
- `.github/workflows/deploy.yml` - on push to `master`, POSTs the `CLOUDFLARE_DEPLOY_HOOK` secret
  (skips with a notice when unset)
- `HOW-TO-ADD-PICTURES.md` - plain-language guide for the person adding pictures

## Commands

```bash
node scripts/add-images.mjs --year 2025 [--project "Name"] [--desc "..."] [--featured] [--original-price <dollars>] [--copies <preset-or-ids>] [--root <gallery>] [--data <json>] [--dry-run] <file-or-folder>...
node scripts/add-images.mjs --about [--root <gallery>] [--dry-run] <file-or-folder>...
node scripts/import.mjs [--folder <path>] [--yes] [--no-publish]
node scripts/reveal-watermark.mjs <file> [out]
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -WhatIf
```

Requires Node 24 and ImageMagick 7 (`magick` on PATH). No npm packages; scripts call `magick`
and `git` through `child_process.execFileSync` with argument arrays (no shell), so they run the
same from PowerShell or Git Bash. `--root` points add-images at another gallery folder (e.g.
`../<other-gallery>-images`), using that folder's `site.json` for the watermark.

## Rules

- Never commit untouched originals. Only the three processed files per picture belong here
  (one file per About photo under `images/about/`).
  `.gitignore` blocks `originals/` and `*.orig.*`
- Every published `.jpg` is: auto-oriented, long edge <= 1200px (never upscaled), metadata
  stripped, watermarked, JPEG quality 80, id in the JPEG comment. Low res on purpose so prints
  get ordered, not printed from the download
- `-mid.webp` (fit 1200x1200, q80) and `-thumb.webp` (400px wide, q75) are made from the
  watermarked full copy, never from the original
- Watermark layers (sizes relative to the short edge, or half the long edge if larger): visible
  corner `© <text>` (white 60%, dark outline); tiled diagonal `© <text>` at 6% gray; 3-5 hidden
  `<text> <id>` at 2% gray placed in the clear bands between tile rows by a generator seeded
  from the id (reproducible)
- `<id>` = `idPrefix` + `-` + first 8 hex of SHA-256 of the original file bytes
- If the hidden marks are retuned, check them with `reveal-watermark.mjs` on a q80 output first
- JSON merges only add: never remove, reorder, or overwrite existing entries, `desc`, or `cover`
  (an empty project `desc` may be filled). New years go in newest-first position. 2-space
  indent, trailing newline
- Picture names are the original basename slugified; existing names in the destination are skipped
- import.mjs is all-or-nothing: on any failure it removes what it wrote and moves no originals.
  User-facing text stays plain English, with technical details underneath
- import.mjs refuses to start unless the repo is on `master` with no changes outside `images/`
  and `project-list.json`; it commits both together as `add N pictures`, pulls with rebase, and
  pushes. Unpushed commits are retried on the next run
- setup.ps1 reads `repo` from `site.json`, makes `~/.ssh/<repo-name>_deploy` and the
  `github-<repo-name>` ssh alias, stops (exit 2) until the key works, and clones through the alias
  into `Documents/<repo-name>`. It stays Windows PowerShell 5.1 compatible and safe to re-run;
  every change goes through `ShouldProcess` so `-WhatIf` changes nothing. `-SshDir`,
  `-DocumentsDir`, `-DesktopDir`, `-RemoteUrl` exist for testing
- `.cmd` and `.ps1` keep CRLF line endings (`.gitattributes`)
- Test against scratch copies (`--root`/`--data` for add-images; for import.mjs a scratch clone
  with a scratch bare remote and `--folder`; for setup.ps1 `-WhatIf` or the test overrides),
  never this repo's real `images/` and `project-list.json`
- File and folder names are kebab-case, except the root launchers named for double-clicking
