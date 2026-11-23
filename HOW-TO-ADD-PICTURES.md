# How to Add Pictures

> Put pictures in a folder, double-click one icon, answer two questions. That's it. No GitHub account needed.

## 📚 Table of Contents

- [Adding Pictures](#-adding-pictures)
- [How to Set Up the Folder](#-how-to-set-up-the-folder)
- [Adding Descriptions](#-adding-descriptions)
- [Featuring Work](#-featuring-work)
- [About You](#-about-you)
- [Your Links](#-your-links)
- [Selling Work](#-selling-work)
- [If Something Goes Wrong](#-if-something-goes-wrong)
- [First-Time Setup (Ryan Does This)](#-first-time-setup-ryan-does-this)

---

## 🖼 Adding Pictures

1. Open the **Documents** folder, then the **To_Import** folder inside it.
2. Copy your pictures into **To_Import**. They can be `.jpg`, `.jpeg` or `.png`.
3. Double-click **Import Pictures** on the Desktop. A black window opens.
4. Read the list it shows. It says how many pictures it found and where they will go.
5. If it looks right, type **Y** and press **Enter**. If not, type **N** and press **Enter**. Nothing changes.
6. Wait while it works on each picture. Big pictures take a few seconds each.
7. It asks: **Publish to the website now?**
   - Type **Y** and press **Enter** to put them on the website now.
   - Type **N** and press **Enter** to wait. They will go up the next time you say **Y**.
8. When you see **Done!**, the website updates in a few minutes.
9. Press any key to close the window.

Your pictures are not deleted. They are moved into **To_Import → Imported**, in a folder named with today's date and time. **To_Import** is then empty and ready for next time.

---

## 📁 How to Set Up the Folder

- A picture placed straight into **To_Import** goes on the website for **this year**, on its own (not in a project).
- A **folder** with a project's name groups pictures into that project, for this year.
- A folder named with a **year** (like `2024`) is for an older year. Put pictures straight in it, or put a project folder inside it.

Example:

```
To_Import
├── sunflower.jpg                  this year, on its own
├── Barn Owl                       project "Barn Owl", this year
│   ├── owl-sketch.jpg
│   ├── owl-finished.jpg
│   └── description.txt            describes the Barn Owl project
└── 2024                           pictures from 2024
    ├── old-doodle.jpg             2024, on its own
    └── Christmas Cards            project "Christmas Cards", 2024
        ├── card-1.jpg
        └── card-1.txt             describes card-1.jpg
```

Tips:

- Type the project folder's name exactly how it should look on the website, like `Barn Owl`.
- Adding more pictures to a project that's already on the website? Use the same folder name.
- A picture with the same name as one already on the website is skipped.
- Leave the **Imported** folder alone. It's only there to keep your originals.

---

## ✏ Adding Descriptions

Descriptions are optional.

- **For a project:** inside the project folder, make a text file named `description.txt` and type the description in it.
- **For one picture:** make a text file with the **same name as the picture**, like `card-1.txt` for `card-1.jpg`.

To make a text file: right-click inside the folder, choose **New → Text Document**, type the name, then open it and type.

---

## ⭐ Featuring Work

The website's home page can show a **Featured** group with the work you're proudest of. To feature a project or a picture, tell Ryan which one. Importing doesn't feature anything by itself.

For Ryan: add `--featured` when running `add-images.mjs`, or put `"featured": true` on the project or picture in `project-list.json`. `"featured"` in `site.json` moves the group above or below Favorites, or turns it off.

---

## 👋 About You

The little **i** button at the top right of the website, next to the light/dark button, opens a few words about you, with photos of you or where you work. You write it; Ryan puts it up.

- **Words:** write them anywhere (an email, a text, a note) and send them to Ryan. Plain paragraphs are perfect. They end up in the file `about.md` in this folder.
- **Photos:** send Ryan the photos you want, and say what each one shows. They are made smaller and the hidden phone details (like where it was taken) are removed, but they don't get the copyright stamp your artwork gets.
- **Changes:** send Ryan the new words any time.

For Ryan: edit `about.md` (Markdown; README "About Page"), add photos with `node scripts/add-images.mjs --about <photo>` and paste the line it prints. Commit the change before the next double-click import; the import stops on changes outside `images/` and `project-list.json`.

---

## 🔗 Your Links

The website can show small Facebook, Instagram, Twitter and email icons at the top right, under the light/dark button, so people can find you elsewhere. Send Ryan the links you want shown (your page addresses and the email to show). Only the ones you send appear.

For Ryan: fill in `social` in `site.json`.

---

## 💲 Selling Work

The website can show prices for your work, but only once Ryan turns the shop on. Until then no prices show anywhere.

Each picture can be sold two ways:

- **The original** - the one you made. You pick its price for each picture, like $225 or $300. Once it sells, tell Ryan and it shows as **Sold**.
- **Copies** - prints, cards and so on, as many as people want. Each kind has a standard price, like $15 for a 5x7 print or $25 for an 8x10 print.

Prices are written in **dollars**, not cents: `25` means $25.

So you don't have to list copies picture by picture, kinds of copies come in named groups called **presets**:

- **standard** - 5x7 print and 8x10 print. Every picture offers these unless you say otherwise.
- **large** - 11x14 print and 16x20 canvas.
- **cards** - pack of 5 cards.

For any picture you can tell Ryan: "standard", "large", "no copies", a mix ("cards and the 8x10 print"), a different price for one copy, or something new just for that picture (like a 3 inch sticker for $4). New kinds of copies and new presets can be added any time.

Importing doesn't put anything up for sale by itself. Tell Ryan which pictures and prices.

For Ryan: the shape is in README "Shop (Selling Work)". `add-images.mjs --original-price 250 --copies large` sets it on new pictures; otherwise edit `sale` in `project-list.json`.

---

## 🆘 If Something Goes Wrong

- If a picture can't be used, **nothing** is imported and your pictures stay in **To_Import**. Check that each picture opens on the computer, then try again.
- If it says it couldn't upload, check the internet and run **Import Pictures** again. Everything is saved and will upload then.
- For anything else, **take a photo of the window and send it to Ryan.** Don't close the window until you have the photo.

---

## 🔧 First-Time Setup (Ryan Does This)

Done once per computer. The person adding pictures doesn't need a GitHub account: their PC gets its own key that can only reach this gallery repo.

1. Copy this repo's folder onto their PC (USB stick or a zip), anywhere.
2. Double-click **Setup.cmd** in it (or run `Setup.cmd` from a cmd or PowerShell prompt; add `-WhatIf` to preview). It:
   - installs Node.js LTS, ImageMagick and Git with winget (when missing)
   - makes a key for this repo (`~\.ssh\craft-showcase-images_deploy`) and an ssh alias `github-craft-showcase-images` that uses it
   - prints the key under **"Send this to Ryan"**, then stops with "Ryan hasn't added the key yet"
3. Add the key on GitHub: **rbrock44/craft-showcase-images → Settings → Deploy keys → Add deploy key**, paste it, tick **Allow write access**, **Add key**.
4. Double-click **Setup.cmd** again. Now it:
   - checks GitHub accepts the key
   - downloads the repo into `Documents\craft-showcase-images` (through the alias, so uploads use the key)
   - sets a Git name ("Craft Showcase import") for that repo if the PC has none
   - creates `Documents\To_Import`
   - puts an **Import Pictures** shortcut on the Desktop
5. If it says a tool isn't on PATH yet, close the window and double-click **Setup.cmd** again. It's safe to re-run; finished steps are skipped.
6. Delete the copied folder. The shortcut points at `Documents\craft-showcase-images`.

To check without changing anything: `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -WhatIf`
