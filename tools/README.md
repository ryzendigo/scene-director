# Tools

## cutout.py — batch background removal

Turns a folder of portraits/sprites into transparent-background RGBA cutouts,
using [rembg](https://github.com/danielgatis/rembg) with the u2net model.
Filenames are preserved (output is always `.png` — JPEG has no alpha channel).

Cast chips render a radial-gradient backing behind each portrait, so cutouts
made with this tool drop straight into `npc/<key>.png` and look grounded
instead of floating on the source photo's background.

### Install

```
pip install rembg onnxruntime pillow
```

> The first run downloads the u2net model (~170 MB) to `~/.u2net/`; every run
> after that is offline.

### Use

```
python cutout.py path/to/portraits                    # -> path/to/portraits/cutout/
python cutout.py path/to/portraits --out path/to/npc  # -> chosen folder
```

Processes every `.png`, `.jpg`, `.jpeg` and `.webp` in the folder (not
recursive). A failed image is reported and skipped; the batch continues.

## Engine test suites

Each pure engine block in `index.js` has a case-based regression suite. They
lift the engine out of the live file, so they exercise exactly what ships, and
run in milliseconds instead of the minutes a browser round-trip costs.

```
node tools/wardrobe-harness.mjs     # what each character is wearing
node tools/mood-cases.mjs           # expression/mood verdict
node tools/presence-cases.mjs       # who is in the scene
node tools/pose-cases.mjs           # pose detection
node tools/background-cases.mjs     # background choice (narration + header)
node tools/atlas-cases.mjs          # place/travel atlas
```

Every suite exits non-zero on failure, so they chain with `&&`. Run them all
before shipping any matcher change — a one-word edit to a shared regex reaches
more than the engine you were working on.

`mood-harness.mjs` and `presence-harness.mjs` are different tools: they replay a
real saved chat and print per-message verdicts for eyeballing, rather than
asserting. The assertion suites are the `-cases` files.

## keyword-collisions.mjs — audit the background keyword tables

```
node tools/keyword-collisions.mjs [path/to/index.js]
```

`DEFAULT_GENERIC` and `DEFAULT_NOUNS` are ordered lists of
`[key, 'alt|alt|alt']`, specific venues first. A keyword claimed by two keys is
a latent bug: which one wins depends on table position rather than meaning, and
nothing fails when it picks wrong. This prints every shared keyword.

Sharing is not automatically wrong. `resort` belongs to both hotel and snow, and
"ski resort" correctly reaches snow. Check each against the engine before
changing it, and pin the answer in `background-cases.mjs`.
