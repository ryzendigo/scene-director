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
