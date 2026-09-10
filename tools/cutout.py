#!/usr/bin/env python3
"""Batch background removal for cast-chip portraits and expression sprites.

Runs every .png/.jpg/.jpeg/.webp in a folder through rembg (u2net model) and
writes RGBA cutouts with transparent backgrounds, preserving each filename
(always saved as .png, since JPEG cannot carry the alpha channel).

Install (a virtualenv is recommended):

    pip install rembg onnxruntime pillow

The first run downloads the u2net model (~170 MB) to ~/.u2net/ — after that
it works offline.

Usage:

    python cutout.py <folder>                 # writes to <folder>/cutout/
    python cutout.py <folder> --out <folder>  # writes to a chosen folder

Scene Director's cast chips draw a radial-gradient backing behind each
portrait, so cutouts drop straight in — heads no longer float on whatever
the original photo's background was.
"""
import argparse
import io
import sys
from pathlib import Path

from PIL import Image
from rembg import new_session, remove

EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('folder', type=Path, help='folder of images to process')
    parser.add_argument('--out', type=Path, default=None,
                        help='output folder (default: <folder>/cutout)')
    args = parser.parse_args()

    src: Path = args.folder
    if not src.is_dir():
        print(f'error: {src} is not a directory', file=sys.stderr)
        return 1
    out: Path = args.out or (src / 'cutout')
    out.mkdir(parents=True, exist_ok=True)

    images = sorted(p for p in src.iterdir()
                    if p.is_file() and p.suffix.lower() in EXTENSIONS)
    if not images:
        print(f'nothing to do: no {"/".join(sorted(EXTENSIONS))} files in {src}')
        return 0

    session = new_session('u2net')  # one model load for the whole batch
    for i, path in enumerate(images, 1):
        target = out / (path.stem + '.png')
        try:
            result = remove(path.read_bytes(), session=session)
            Image.open(io.BytesIO(result)).convert('RGBA').save(target)
            print(f'[{i}/{len(images)}] {path.name} -> {target}')
        except Exception as e:  # keep going; report at the end
            print(f'[{i}/{len(images)}] {path.name} FAILED: {e}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
