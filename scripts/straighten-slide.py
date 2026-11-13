#!/usr/bin/env python3
"""Straighten a slide photographed at an angle: find the screen's four corners
and warp it to a flat rectangle (perspective / keystone correction).

Used when a talk page crops a slide out of a filed photo. The original in
talks/<slug>/photos/ is never touched; the output goes in experience/.

Corners are found automatically: the projected slide is the largest bright
region in the photo, and its corners are the extreme points of that region.
That works for a lit screen in a dark room. When a speaker stands in front of
the slide, or the slide is dark, pass the corners by hand (in original-pixel
coordinates, top-left, top-right, bottom-right, bottom-left).

Usage:
  python3 scripts/straighten-slide.py IN.jpg OUT.jpg [--aspect 16:9]
         [--corners x1,y1,x2,y2,x3,y3,x4,y4] [--width 1600] [--dry-run]

Needs ImageMagick (`magick`), Pillow and numpy.
"""
import argparse
import importlib.util
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def _load_cleaner():
    path = Path(__file__).with_name("clean-slides.py")
    spec = importlib.util.spec_from_file_location("clean_slides", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load cleaner module from {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_corners(path: str, work: int = 640):
    img = ImageOps.exif_transpose(Image.open(path))
    W, H = img.size
    scale = work / max(W, H)
    small = img.convert("L").resize((max(1, int(W * scale)), max(1, int(H * scale))))
    a = np.asarray(small, dtype=np.float32)
    # Bright = above a threshold halfway between the median and the 99th percentile.
    thr = (np.median(a) + np.percentile(a, 99)) / 2
    mask = a > thr
    h, w = mask.shape
    seen = np.zeros_like(mask)
    best = []
    for y0 in range(0, h, 4):
        for x0 in range(0, w, 4):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            comp, q = [], deque([(y0, x0)])
            seen[y0, x0] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(comp) > len(best):
                best = comp
    if len(best) < 0.03 * h * w:
        raise SystemExit(f"no screen-sized bright region found in {path}; pass --corners")
    pts = np.array(best, dtype=np.float32)
    ys, xs = pts[:, 0], pts[:, 1]
    tl = pts[np.argmin(xs + ys)]
    br = pts[np.argmax(xs + ys)]
    tr = pts[np.argmax(xs - ys)]
    bl = pts[np.argmin(xs - ys)]
    corners = [(p[1] / scale, p[0] / scale) for p in (tl, tr, br, bl)]
    return corners, (W, H)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--aspect", default="16:9", help="slide aspect, e.g. 16:9 or 4:3; 'auto' measures it")
    ap.add_argument("--corners", help="x1,y1,x2,y2,x3,y3,x4,y4 in original pixels: TL, TR, BR, BL")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-clean", action="store_true", help="skip tonal/cast restoration (still converts Display P3 to sRGB)")
    ap.add_argument("--mode", choices=["auto", "dark", "light", "color", "illustration", "stage"], default="auto")
    args = ap.parse_args()

    if args.corners:
        v = [float(n) for n in args.corners.split(",")]
        if len(v) != 8:
            sys.exit("--corners needs 8 numbers")
        corners = [(v[0], v[1]), (v[2], v[3]), (v[4], v[5]), (v[6], v[7])]
    else:
        corners, _ = find_corners(args.src)

    tl, tr, br, bl = corners
    dist = lambda p, q: ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5
    if not args.corners:
        # Refuse a shape that isn't a plausible screen: a degenerate or very
        # lopsided quadrilateral means the bright region wasn't the slide
        # (an LED wall, a speaker in front). Better no warp than a smeared one.
        top, bottom, left, right = dist(tl, tr), dist(bl, br), dist(tl, bl), dist(tr, br)
        shoelace = 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(corners, corners[1:] + corners[:1])))
        xs, ys = [p[0] for p in corners], [p[1] for p in corners]
        fill = shoelace / max(1.0, (max(xs) - min(xs)) * (max(ys) - min(ys)))
        sides_ok = min(top, bottom) / max(top, bottom) > 0.6 and min(left, right) / max(left, right) > 0.6
        aspect = (top + bottom) / max(1.0, left + right)
        if fill < 0.6 or not sides_ok or not 0.9 < aspect < 3.0:
            sys.exit(f"auto corners don't look like a slide ({', '.join(f'({x:.0f},{y:.0f})' for x, y in corners)}); "
                     "pass --corners TL,TR,BR,BL or keep a plain crop")
    if args.aspect == "auto":
        ratio = max(dist(tl, tr), dist(bl, br)) / max(dist(tl, bl), dist(tr, br))
    else:
        a, b = (float(n) for n in args.aspect.split(":"))
        ratio = a / b
    W = args.width
    H = int(round(W / ratio))
    target = [(0, 0), (W, 0), (W, H), (0, H)]
    pairs = " ".join(f"{s[0]:.1f},{s[1]:.1f} {d[0]},{d[1]}" for s, d in zip(corners, target))
    print("corners", ", ".join(f"({x:.0f},{y:.0f})" for x, y in corners), f"→ {W}x{H}")
    if args.dry_run:
        return
    cleaner = _load_cleaner()
    with Image.open(args.src) as src_img:
        fallback_p3_bytes = src_img.info.get("icc_profile")

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        subprocess.run(
            ["magick", args.src, "-auto-orient", "-virtual-pixel", "edge",
             "-define", f"distort:viewport={W}x{H}+0+0",
             "-distort", "Perspective", pairs, "+repage", str(tmp_path)],
            check=True,
        )
        with Image.open(tmp_path) as warped:
            if args.no_clean:
                out_img = cleaner.to_srgb(warped, fallback_p3_bytes=fallback_p3_bytes)
            else:
                out_img, cls = cleaner.clean_slide_image(
                    warped,
                    path_hint=args.out,
                    mode=args.mode,
                    fallback_p3_bytes=fallback_p3_bytes,
                )
                print(f"  cleaned ({cls})")
        cleaner.save_srgb_jpeg(out_img, args.out)
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
