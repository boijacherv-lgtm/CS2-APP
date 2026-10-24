# Demo download kit (for another computer)

Downloads training demos for Stratboard's coach on a PC with more space, straight onto the external disk
**"Внешка"**: the helpers find it by its name when it's plugged in (else `--out <folder>`).

- `faceit-download-helper.mjs` + `faceit-links.txt`: FACEIT level-10 matches (the current list: 353 new demos to bring every map to about 120, ~65 GB; matches already downloaded aren't on it)
- `hltv-download-helper.mjs`: HLTV pro matches (60 per map, ~70–90 GB)

You download each demo yourself in the browser (logged in to FACEIT; HLTV's bot check passed by you). The helpers
open the pages, watch your Downloads folder, and move every finished demo onto the disk, sorted by map.

## On Windows

1. Install **Node.js** 18+ (nodejs.org) and **7-Zip** (7-zip.org, for HLTV's .rar archives).
2. Plug in the disk. Open **PowerShell** and paste this (it puts the kit on the disk, in `stratboard`):

   ```powershell
   $d = "$((Get-Volume | ? FileSystemLabel -eq 'Внешка').DriveLetter):\stratboard"; mkdir $d -Force | Out-Null; cd $d
   foreach ($f in 'faceit-download-helper.mjs','hltv-download-helper.mjs','faceit-links.txt') { iwr "https://raw.githubusercontent.com/boijacherv-lgtm/CS2-APP/main/download-kit/$f" -OutFile $f }
   ```

3. FACEIT: `node faceit-download-helper.mjs --batch 5`
   On each page it opens, click **Watch demo** and download. **Enter** = skip a match with no demo (a spare
   replaces it), **q** = stop. Run it again to continue.
4. HLTV: `node hltv-download-helper.mjs`
   Open a match on the results page, click its demo download. **n** = next map that needs demos, **q** = stop.

Demos end up on the disk in `faceit-demos\<map>\` and `pro-demos\<map>\`.

## Back on the Mac

The Mac reads the disk (it can't write to NTFS). Copy `faceit-demos` and `pro-demos` from it into `~/Desktop/APPS/`, then:

```bash
npm run learn:all -- ~/Desktop/APPS/faceit-demos
```

## Reading the demos for training (optional, saves sending 65 GB)

The slow part of training is reading each demo. It can run on this PC; the result is one small file (a
"training pack", about 1 MB per 10 demos) to send instead of the disk.

1. Install **Node.js 24** (nodejs.org, LTS) and **Git** (git-scm.com), or skip Git and download the code as a ZIP:
   github.com/boijacherv-lgtm/CS2-APP → **Code → Download ZIP**, then unzip it.
2. In PowerShell, get the code and its libraries (once; `git pull` later to update):

   ```powershell
   cd $HOME
   git clone https://github.com/boijacherv-lgtm/CS2-APP.git
   cd CS2-APP
   npm install
   ```

   Use `npm install`, not `npm ci`: the demo reader lists builds for other systems that were never published, and
   newer npm versions refuse `npm ci` because of them.

3. Read the new demos and pack them (only the matches on the current list, so last time's demos aren't read again;
   about 1–2 hours for 350 demos, it uses every CPU core; keep the PC awake):

   ```powershell
   npm run pack:training -- E:\faceit-demos --only E:\stratboard\faceit-links.txt
   ```

   It saves `training-pack-<date>.sbpack` in the `CS2-APP` folder (about 0.8 MB a demo: each demo's read is in it).
   Send that file (Drive, Telegram…). `--out D:\packs\my-pack.sbpack` saves it elsewhere; `--workers 2` uses fewer
   cores (less memory). Run `git pull` first: a pack made by older code is missing what the newer coach learns from.

On the Mac, the pack is added with `npm run import:training -- <pack>`, then trained on (see the import tool's notes).
A zipped `.stratboard-parsed` folder works too: `npm run import:training -- <unzipped folder>`.
