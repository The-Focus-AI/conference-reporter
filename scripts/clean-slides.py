#!/usr/bin/env python3
"""Restore washed-out conference slide photos and speaker stage photos.

Handles Display P3 -> sRGB color profile conversion, thin bezel auto-trimming,
2D quadratic illumination & ambient-veil removal, white-balance neutralization,
tone mapping, chroma restoration, edge sharpening, and 4:4:4 sRGB JPEG output.

Usage:
  python3 scripts/clean-slides.py IN.jpg OUT.jpg [--mode auto|dark|light|color|illustration|stage]
                                 [--fallback-p3 RAW.jpg] [--path-hint SLUG/experience/IMG.jpg]
  python3 scripts/clean-slides.py --batch LIST.json
"""
import argparse
import io
import json
import os
import stat
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageCms, ImageFilter, ImageOps

LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Images whose class the auto-detector gets wrong, matched by path suffix. These
# are build data: pass --mode per image, or "mode" per batch job, instead of
# listing them here. A build may keep its own overrides in this tuple.
STAGE_PHOTOS: tuple[str, ...] = ()

ILLUSTRATIONS: tuple[str, ...] = ()

_SRGB_PROFILE = ImageCms.createProfile("sRGB")
SRGB_BYTES = ImageCms.ImageCmsProfile(_SRGB_PROFILE).tobytes()


def compute_luma(arr: np.ndarray) -> np.ndarray:
    """Compute Rec.709 luminance from an RGB float32 array."""
    return arr[:, :, 0] * 0.2126 + arr[:, :, 1] * 0.7152 + arr[:, :, 2] * 0.0722


def compute_sat(arr: np.ndarray) -> np.ndarray:
    """Compute HSV-style saturation in [0, 1] from an RGB float32 array."""
    hi = np.max(arr, axis=2)
    lo = np.min(arr, axis=2)
    return (hi - lo) / np.maximum(hi, 1.0)


def to_srgb(img: Image.Image, fallback_p3_bytes: Optional[bytes] = None) -> Image.Image:
    """Orient an image and convert any non-sRGB ICC profile (e.g., Display P3) to sRGB."""
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    icc = img.info.get("icc_profile")
    if not icc and fallback_p3_bytes:
        icc = fallback_p3_bytes
    if icc:
        desc = ImageCms.getProfileDescription(io.BytesIO(icc)) or ""
        if "srgb" not in desc.lower():
            img = ImageCms.profileToProfile(
                img,
                io.BytesIO(icc),
                _SRGB_PROFILE,
                renderingIntent=ImageCms.Intent.PERCEPTUAL,
                outputMode="RGB",
            )
    return img


def _measure_ring(arr: np.ndarray) -> tuple[float, float, float, np.ndarray]:
    """Sample perimeter margin ring (5%..18% inset) to estimate slide background tone."""
    H, W = arr.shape[:2]
    L = compute_luma(arr)
    S = compute_sat(arr)

    yy, xx = np.ogrid[:H, :W]
    outer = (yy >= int(H * 0.05)) & (yy < int(H * 0.95)) & (xx >= int(W * 0.05)) & (xx < int(W * 0.95))
    inner = (yy >= int(H * 0.18)) & (yy < int(H * 0.82)) & (xx >= int(W * 0.18)) & (xx < int(W * 0.82))
    ring = outer & (~inner) & (L > 18.0)

    if int(np.sum(ring)) < 100:
        ring = outer & (~inner)

    vals = L[ring]
    svals = S[ring]
    hist, edges = np.histogram(vals, bins=32, range=(18.0, 255.0))
    b_max = int(np.argmax(hist))
    lo_edge = edges[max(0, b_max - 1)]
    hi_edge = edges[min(len(hist), b_max + 2)]
    peak_mask = (vals >= lo_edge) & (vals <= hi_edge)

    if int(np.sum(peak_mask)) < 20:
        peak_mask = np.ones_like(vals, dtype=bool)

    bg_luma = float(np.median(vals[peak_mask]))
    bg_sat = float(np.median(svals[peak_mask]))

    rgb_ring = arr[ring][peak_mask]
    bg_rgb = np.median(rgb_ring, axis=0).astype(np.float32)

    L_int = L[int(H * 0.08):int(H * 0.92), int(W * 0.08):int(W * 0.92)]
    p98_5 = float(np.percentile(L_int, 98.5))
    return bg_luma, bg_sat, p98_5, bg_rgb


def classify_image(path_hint: str, arr: np.ndarray, mode: str = "auto") -> str:
    """Classify an image into stage, illustration, color, light, or dark."""
    if mode != "auto":
        return mode
    norm_hint = path_hint.replace("\\", "/")
    if any(norm_hint.endswith(s) for s in STAGE_PHOTOS):
        return "stage"
    if any(norm_hint.endswith(s) for s in ILLUSTRATIONS):
        return "illustration"

    bg_luma, bg_sat, p98_5, _ = _measure_ring(arr)
    if bg_sat > 0.60:
        return "color"
    if (bg_luma >= 145.0 and (p98_5 - bg_luma) < 47.0) or bg_luma >= 185.0:
        return "light"
    return "dark"


def trim_dark_bezel(arr: np.ndarray) -> np.ndarray:
    """Trim thin dark outer bezels (<= 3.2% per side) and resize back to original WxH."""
    H, W = arr.shape[:2]
    L = compute_luma(arr)
    x0, x1 = int(W * 0.15), int(W * 0.85)
    y0, y1 = int(H * 0.15), int(H * 0.85)

    def scan_side(strips: np.ndarray, ref_strips: np.ndarray, max_trim: int) -> int:
        ref_luma = float(np.median(ref_strips))
        if ref_luma <= 68.0:
            return 0
        thresh = min(52.0, ref_luma * 0.48)
        trim = 0
        for i in range(max_trim):
            if float(np.percentile(strips[i], 75)) < thresh:
                trim = i + 1
            else:
                break
        return trim

    top_max = int(round(0.032 * H))
    bot_max = int(round(0.032 * H))
    left_max = int(round(0.032 * W))
    right_max = int(round(0.032 * W))

    top = scan_side(L[:top_max, x0:x1], L[int(H * 0.045):int(H * 0.085), x0:x1], top_max)
    bot = scan_side(L[H - bot_max:H, x0:x1][::-1], L[int(H * 0.915):int(H * 0.955), x0:x1], bot_max)
    left = scan_side(L[y0:y1, :left_max].T, L[y0:y1, int(W * 0.045):int(W * 0.085)], left_max)
    right = scan_side(L[y0:y1, W - right_max:W].T[::-1], L[y0:y1, int(W * 0.915):int(W * 0.955)], right_max)

    if top == 0 and bot == 0 and left == 0 and right == 0:
        return arr

    cropped = arr[top:H - bot, left:W - right]
    pil_crop = Image.fromarray(np.clip(cropped, 0, 255).astype(np.uint8), mode="RGB")
    resized = pil_crop.resize((W, H), Image.Resampling.LANCZOS)
    return np.asarray(resized, dtype=np.float32)


def fit_quad_surface(
    u_pts: np.ndarray,
    v_pts: np.ndarray,
    z_pts: np.ndarray,
    weights: np.ndarray,
    H: int,
    W: int,
) -> np.ndarray:
    """Fit a gentle 2D quadratic surface with ridge-stabilized Huber IRLS."""
    X = np.column_stack([
        np.ones_like(u_pts),
        u_pts,
        v_pts,
        u_pts * u_pts,
        u_pts * v_pts,
        v_pts * v_pts,
    ])
    R = np.diag([0.0, 0.0, 0.0, 0.08, 0.08, 0.08])
    w = weights.astype(np.float64).copy()
    z = z_pts.astype(np.float64)
    delta = 6.0

    beta = np.zeros(6, dtype=np.float64)
    for _ in range(6):
        Xw = X * w[:, None]
        A = Xw.T @ X + R
        b = Xw.T @ z
        beta = np.linalg.solve(A, b)
        resid = np.abs(z - X @ beta)
        huber = np.where(resid <= delta, 1.0, delta / np.maximum(resid, 1e-6))
        w = weights * huber

    ug = np.linspace(-1.0, 1.0, W, dtype=np.float32)[None, :]
    vg = np.linspace(-1.0, 1.0, H, dtype=np.float32)[:, None]
    surf = (
        beta[0]
        + beta[1] * ug
        + beta[2] * vg
        + beta[3] * (ug * ug)
        + beta[4] * (ug * vg)
        + beta[5] * (vg * vg)
    )
    return surf.astype(np.float32)


def _grid_bounds(H: int, W: int, nx: int = 8, ny: int = 6):
    ys = np.linspace(0, H, ny + 1, dtype=int)
    xs = np.linspace(0, W, nx + 1, dtype=int)
    cells = []
    for j in range(ny):
        for i in range(nx):
            y0, y1 = int(ys[j]), int(ys[j + 1])
            x0, x1 = int(xs[i]), int(xs[i + 1])
            u = ((x0 + x1) * 0.5 / W) * 2.0 - 1.0
            v = ((y0 + y1) * 0.5 / H) * 2.0 - 1.0
            cells.append((u, v, y0, y1, x0, x1))
    return cells


def _clean_light(arr: np.ndarray, bg_luma: float) -> np.ndarray:
    H, W = arr.shape[:2]
    L = compute_luma(arr)
    S_spread = np.max(arr, axis=2) - np.min(arr, axis=2)

    u_pts, v_pts, rgb_pts, w_pts = [], [], [], []
    for u, v, y0, y1, x0, x1 in _grid_bounds(H, W):
        cell_arr = arr[y0:y1, x0:x1]
        cell_L = L[y0:y1, x0:x1]
        cell_sp = S_spread[y0:y1, x0:x1]

        p65, p97 = np.percentile(cell_L, [65.0, 97.0])
        mask = (cell_sp < 55.0) & (cell_L >= p65) & (cell_L <= p97)
        if int(np.sum(mask)) < 25:
            mask = (cell_L >= p65) & (cell_L <= p97)
        if int(np.sum(mask)) < 10:
            continue

        sample_L = cell_L[mask]
        l85 = float(np.percentile(sample_L, 85.0))
        if l85 < bg_luma - 45.0:
            continue

        sample_rgb = cell_arr[mask]
        hi_sel = sample_L >= np.percentile(sample_L, 70.0)
        est_rgb = np.percentile(sample_rgb[hi_sel], 85.0, axis=0)
        u_pts.append(u)
        v_pts.append(v)
        rgb_pts.append(est_rgb)
        w_pts.append(1.0)

    if len(u_pts) < 8:
        neutral = (S_spread < 60.0) & (L >= np.percentile(L, 75.0)) & (L <= np.percentile(L, 98.0))
        if int(np.sum(neutral)) < 50:
            neutral = L >= np.percentile(L, 85.0)
        est = np.percentile(arr[neutral], 88.0, axis=0).astype(np.float32)
        W_rgb = np.broadcast_to(est[None, None, :], (H, W, 3)).copy()
    else:
        u_arr = np.array(u_pts, dtype=np.float64)
        v_arr = np.array(v_pts, dtype=np.float64)
        w_arr = np.array(w_pts, dtype=np.float64)
        rgb_arr = np.array(rgb_pts, dtype=np.float64)
        W_rgb = np.stack(
            [fit_quad_surface(u_arr, v_arr, rgb_arr[:, c], w_arr, H, W) for c in range(3)],
            axis=2,
        )

    W_rgb = np.maximum(W_rgb, 65.0)
    W_luma = compute_luma(W_rgb)
    med_rgb = np.array([float(np.median(W_rgb[:, :, c])) for c in range(3)], dtype=np.float32)
    ml = float(np.median(W_luma))

    ref_rgb = ml + 0.08 * np.clip(med_rgb - ml, -25.0, 25.0)

    iy0, iy1 = int(H * 0.08), int(H * 0.92)
    ix0, ix1 = int(W * 0.08), int(W * 0.92)
    L_flat = L[iy0:iy1, ix0:ix1] * (ml / np.maximum(W_luma[iy0:iy1, ix0:ix1], 65.0))
    ratio_hi = float(np.percentile(L_flat, 99.2)) / max(1.0, float(np.percentile(L_flat, 65.0)))
    target_bg = float(np.clip(250.0 / max(1.0, ratio_hi), 236.0, 248.5))

    scale = (target_bg * (ref_rgb / max(ml, 1.0)))[None, None, :] / W_rgb
    norm = arr * scale

    by0, by1 = int(H * 0.06), int(H * 0.94)
    bx0, bx1 = int(W * 0.06), int(W * 0.94)
    L_norm = compute_luma(norm)
    dark_pt = float(np.percentile(L_norm[by0:by1, bx0:bx1], 0.35))
    slope = float(np.clip((target_bg - 14.0) / max(32.0, target_bg - dark_pt), 1.05, 2.35))
    out = target_bg - (target_bg - norm) * slope

    S_norm = compute_sat(np.clip(norm, 0.0, 255.0))
    L_out = compute_luma(out)[:, :, None]
    chroma = out - L_out
    vibrance = np.where(S_norm > 0.14, 1.12, 1.0)[:, :, None]
    out = L_out + chroma * vibrance

    out = np.where(out > 246.0, 246.0 + 9.0 * np.tanh((out - 246.0) / 9.0), out)
    return np.clip(out, 0.0, 255.0)


def _clean_dark(arr: np.ndarray, bg_luma: float, bg_rgb_ring: np.ndarray) -> np.ndarray:
    H, W = arr.shape[:2]
    L = compute_luma(arr)
    S = compute_sat(arr)

    u_pts, v_pts, rgb_pts, w_pts = [], [], [], []
    for u, v, y0, y1, x0, x1 in _grid_bounds(H, W):
        cell_arr = arr[y0:y1, x0:x1]
        cell_L = L[y0:y1, x0:x1]
        cell_S = S[y0:y1, x0:x1]

        valid_px = cell_L > 8.0
        if int(np.sum(valid_px)) < 30:
            continue

        c_luma = float(np.percentile(cell_L[valid_px], 22.0))
        if c_luma >= bg_luma + 28.0:
            continue

        band = valid_px & (np.abs(cell_L - c_luma) <= 8.0)
        if int(np.sum(band)) < 15:
            continue

        if float(np.median(cell_S[band])) >= 0.42:
            continue

        est_rgb = np.median(cell_arr[band], axis=0)
        u_pts.append(u)
        v_pts.append(v)
        rgb_pts.append(est_rgb)
        w_pts.append(1.0)

    if len(u_pts) < 8:
        B_rgb = np.broadcast_to(bg_rgb_ring[None, None, :], (H, W, 3)).copy()
    else:
        u_arr = np.array(u_pts, dtype=np.float64)
        v_arr = np.array(v_pts, dtype=np.float64)
        w_arr = np.array(w_pts, dtype=np.float64)
        rgb_arr = np.array(rgb_pts, dtype=np.float64)
        B_rgb = np.stack(
            [fit_quad_surface(u_arr, v_arr, rgb_arr[:, c], w_arr, H, W) for c in range(3)],
            axis=2,
        )

    B_rgb = np.clip(B_rgb, 0.0, 220.0)
    B_luma = compute_luma(B_rgb)

    headroom = np.clip((253.0 - arr) / 48.0, 0.12, 1.0)
    decast = arr - (B_rgb - B_luma[:, :, None]) * headroom

    L_d = compute_luma(decast)
    sat_d = compute_sat(np.clip(decast, 0.0, 255.0))
    hi_thresh = float(np.percentile(L_d, 98.5))
    hi_mask = (L_d >= hi_thresh) & (sat_d < 0.28)
    if int(np.sum(hi_mask)) > 50:
        hi_rgb = decast[hi_mask]
        hi_luma_px = L_d[hi_mask]
        hi_tint = np.median(hi_rgb - hi_luma_px[:, None], axis=0).astype(np.float32)
        hi_luma = float(np.median(hi_luma_px))
        b_med = float(np.median(B_luma))
        weight = np.clip((L_d - B_luma) / max(40.0, hi_luma - b_med), 0.0, 1.0)
        decast = decast - 0.70 * hi_tint[None, None, :] * weight[:, :, None]

    L_d = compute_luma(decast)
    delta = L_d - B_luma
    iy0, iy1 = int(H * 0.06), int(H * 0.94)
    ix0, ix1 = int(W * 0.06), int(W * 0.94)
    hi_delta = max(55.0, float(np.percentile(delta[iy0:iy1, ix0:ix1], 99.2)))
    veil_strength = float(np.clip((float(np.median(B_luma)) - 25.0) / 135.0, 0.0, 1.0))

    target_dark = 17.0
    pos_scaled = target_dark + (247.0 - target_dark) * (np.clip(delta / hi_delta, 0.0, 1.12) ** 0.86)
    pos_scaled = np.where(pos_scaled > 243.0, 243.0 + 11.0 * np.tanh((pos_scaled - 243.0) / 11.0), pos_scaled)
    neg_scaled = target_dark + 11.0 * np.tanh(delta / 22.0)
    L_out = np.where(delta >= 0.0, pos_scaled, neg_scaled)

    chroma = decast - L_d[:, :, None]
    chroma_gain = 1.0 + (0.14 + 0.42 * veil_strength) * np.clip((L_out - 22.0) / 38.0, 0.0, 1.0)
    out = L_out[:, :, None] + chroma * chroma_gain[:, :, None]
    return np.clip(out, 0.0, 255.0)


def _clean_color(arr: np.ndarray) -> np.ndarray:
    H, W = arr.shape[:2]
    L = compute_luma(arr)
    S = compute_sat(arr)

    u_pts, v_pts, l_pts, w_pts = [], [], [], []
    for u, v, y0, y1, x0, x1 in _grid_bounds(H, W):
        cell_L = L[y0:y1, x0:x1]
        cell_S = S[y0:y1, x0:x1]
        mask = cell_S > 0.50
        if int(np.sum(mask)) < 25:
            continue
        u_pts.append(u)
        v_pts.append(v)
        l_pts.append(float(np.median(cell_L[mask])))
        w_pts.append(1.0)

    if len(u_pts) >= 8:
        B_luma = fit_quad_surface(
            np.array(u_pts, dtype=np.float64),
            np.array(v_pts, dtype=np.float64),
            np.array(l_pts, dtype=np.float64),
            np.array(w_pts, dtype=np.float64),
            H,
            W,
        )
        B_luma = np.maximum(B_luma, 35.0)
        med_b = float(np.median(B_luma))
        norm = arr * (med_b / B_luma)[:, :, None]
    else:
        norm = arr.copy()

    L_n = compute_luma(norm)
    lo = float(np.percentile(L_n, 0.5))
    hi = float(np.percentile(L_n, 99.3))
    scale = (247.0 - 14.0) / max(40.0, hi - lo)
    L_out = 14.0 + (L_n - lo) * scale
    L_out = np.where(L_out > 243.0, 243.0 + 11.0 * np.tanh((L_out - 243.0) / 11.0), L_out)
    L_out = np.clip(L_out, 0.0, 255.0)

    chroma = norm - L_n[:, :, None]
    out = L_out[:, :, None] + chroma * 1.10
    return np.clip(out, 0.0, 255.0)


def _clean_illustration(arr: np.ndarray) -> np.ndarray:
    L = compute_luma(arr)
    lo = float(np.percentile(L, 0.6))
    hi = float(np.percentile(L, 99.3))
    scale = (248.0 - 12.0) / max(40.0, hi - lo)
    L_lin = np.clip(12.0 + (L - lo) * scale, 0.0, 255.0)
    t = np.clip((L_lin - 12.0) / (248.0 - 12.0), 0.0, 1.0)
    L_out = np.clip(L_lin + 4.0 * np.sin(2.0 * np.pi * t), 0.0, 255.0)

    chroma = arr - L[:, :, None]
    gain = 1.10 * (scale ** 0.25 if scale < 1.0 else 1.0)
    out = L_out[:, :, None] + chroma * gain
    return np.clip(out, 0.0, 255.0)


def _clean_stage(arr: np.ndarray) -> np.ndarray:
    L = compute_luma(arr)
    lo = float(np.percentile(L, 0.5))
    hi = float(np.percentile(L, 99.5))
    target_lo = max(4.0, lo * 0.55)
    target_hi = 247.0
    t = np.clip((L - lo) / max(40.0, hi - lo), 0.0, 1.0)
    t_curve = np.clip((t ** 0.94) - 0.05 * np.sin(2.0 * np.pi * t), 0.0, 1.0)
    L_out = target_lo + (target_hi - target_lo) * t_curve

    chroma = arr - L[:, :, None]
    out = L_out[:, :, None] + chroma * 1.06
    return np.clip(out, 0.0, 255.0)


def clean_slide_image(
    img: Image.Image,
    path_hint: str = "",
    mode: str = "auto",
    fallback_p3_bytes: Optional[bytes] = None,
) -> tuple[Image.Image, str]:
    """Convert Display P3 -> sRGB, trim bezel if slide, restore tones & colors, and sharpen."""
    srgb = to_srgb(img, fallback_p3_bytes=fallback_p3_bytes)
    arr = np.asarray(srgb, dtype=np.float32)

    cls = classify_image(path_hint, arr, mode=mode)
    if cls != "stage":
        arr = trim_dark_bezel(arr)

    bg_luma, _, _, bg_rgb = _measure_ring(arr)

    if cls == "stage":
        cleaned = _clean_stage(arr)
        unsharp = ImageFilter.UnsharpMask(radius=0.9, percent=45, threshold=4)
    elif cls == "illustration":
        cleaned = _clean_illustration(arr)
        unsharp = ImageFilter.UnsharpMask(radius=1.1, percent=68, threshold=3)
    elif cls == "color":
        cleaned = _clean_color(arr)
        unsharp = ImageFilter.UnsharpMask(radius=1.1, percent=68, threshold=3)
    elif cls == "light":
        cleaned = _clean_light(arr, bg_luma)
        unsharp = ImageFilter.UnsharpMask(radius=1.1, percent=68, threshold=3)
    else:
        cleaned = _clean_dark(arr, bg_luma, bg_rgb)
        unsharp = ImageFilter.UnsharpMask(radius=1.1, percent=68, threshold=3)

    out_img = Image.fromarray(np.clip(np.rint(cleaned), 0, 255).astype(np.uint8), mode="RGB")
    out_img = out_img.filter(unsharp)
    return out_img, cls


def save_srgb_jpeg(img: Image.Image, out_path: str) -> None:
    """Save an RGB Image as high-quality 4:4:4 JPEG with embedded sRGB ICC profile."""
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=92, subsampling=0, optimize=True, icc_profile=SRGB_BYTES)


def process_one(
    src_path: str,
    out_path: str,
    mode: str = "auto",
    fallback_p3_path: Optional[str] = None,
    path_hint: Optional[str] = None,
) -> str:
    fallback_bytes = None
    if fallback_p3_path:
        with Image.open(fallback_p3_path) as fb:
            fallback_bytes = fb.info.get("icc_profile")
    with Image.open(src_path) as src:
        out_img, cls = clean_slide_image(
            src,
            path_hint=path_hint or out_path,
            mode=mode,
            fallback_p3_bytes=fallback_bytes,
        )
    save_srgb_jpeg(out_img, out_path)
    return cls


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--mode", choices=["auto", "dark", "light", "color", "illustration", "stage"], default="auto")
    ap.add_argument("--fallback-p3", help="raw photo to read Display P3 ICC profile from if input lacks ICC")
    ap.add_argument("--path-hint", help="canonical experience path used for classification overrides")
    ap.add_argument("--batch", help="JSON file of [{src, out, path_hint?, mode?, fallback_p3?}]")
    args = ap.parse_args()

    if args.batch:
        jobs = json.loads(Path(args.batch).read_text())
        counts: dict[str, int] = {}
        for job in jobs:
            cls = process_one(
                job["src"],
                job["out"],
                mode=job.get("mode", "auto"),
                fallback_p3_path=job.get("fallback_p3"),
                path_hint=job.get("path_hint") or job["out"],
            )
            counts[cls] = counts.get(cls, 0) + 1
            print(f"[{cls:12s}] {job['out']}")
        print("Summary:", counts)
        return

    if not args.src or not args.out:
        ap.error("provide SRC OUT or --batch LIST.json")

    cls = process_one(
        args.src,
        args.out,
        mode=args.mode,
        fallback_p3_path=args.fallback_p3,
        path_hint=args.path_hint or args.out,
    )
    print(f"[{cls}] {args.out}")


if __name__ == "__main__":
    main()
