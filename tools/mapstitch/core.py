"""Registration and compositing of floor-map screenshots.

Every screenshot shows the same vector floor plan through the app's map
viewport, panned (and occasionally pinch-zoomed) between captures. The plan is
rendered flat, so two screenshots of the same area agree pixel-for-pixel apart
from JPEG noise. That lets us register tiles exhaustively and then *prove* each
seam by measuring the colour residual over the whole overlap.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

# Viewport interior inside the rounded frame (1080x2340 screenshots), measured
# from the frame border at x=28..31 / 1048..1051 and y=124..127 / 2117..2119.
INTERIOR_X0, INTERIOR_X1 = 34, 1046
INTERIOR_Y0, INTERIOR_Y1 = 130, 2114
CORNER_RADIUS = 52
# The floor-title pill; its bottom border sits on one of these rows depending
# on whether the title wraps onto two lines. The drop shadow reaches ~44px.
PILL_BOTTOM_ROWS = (315, 267)
HEADER_SHADOW = 50
# Floating "locate" and "search" buttons. Their soft drop shadow darkens the
# map beneath by at most ~6%; fab-shadow.png holds the measured per-channel
# transmission (x255) of that region, taken from a screenshot that is blank
# there (identical, within JPEG noise, on every other blank screenshot). Pixels
# darkened by more than 10% (the opaque buttons and their rims) are masked;
# the rest are divided back to their true colour by `deshadow`.
FAB_SHADOW_ORIGIN = (700, 1890)
FAB_SHADOW = cv2.imread(str(Path(__file__).with_name("fab-shadow.png")), cv2.IMREAD_COLOR)
FAB_MIN_TRANSMISSION = 230

SCREEN_SHAPE = (2340, 1080)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(path: Path):
    """Sort "2.jpg" before "10.jpg"; screenshot names sort by their timestamp."""
    stem = path.stem
    return (0, int(stem), "") if stem.isdigit() else (1, 0, path.name)


def list_tiles(folder: Path) -> list[Path]:
    tiles = [p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS and not p.name.startswith(("crop-", "debug", "stitched"))]
    return sorted(tiles, key=natural_key)


def header_bottom(images: list[np.ndarray]) -> int:
    """Row of the title pill's bottom border, agreed by every tile of a floor."""
    for row in PILL_BOTTOM_ROWS:
        if all((img[row - 1:row + 2, 300:780].mean(axis=2) < 110).any(axis=0).mean() > 0.95 for img in images):
            return row
    raise ValueError("Could not locate the floor-title pill in these screenshots")


def viewport_mask(pill_bottom: int) -> np.ndarray:
    """1 where a screenshot pixel shows the map, 0 for chrome and overlays."""
    mask = np.zeros(SCREEN_SHAPE, np.uint8)
    mask[INTERIOR_Y0:INTERIOR_Y1, INTERIOR_X0:INTERIOR_X1] = 1
    mask[:pill_bottom + HEADER_SHADOW] = 0
    x0, y0 = FAB_SHADOW_ORIGIN
    h, w = FAB_SHADOW.shape[:2]
    mask[y0:y0 + h, x0:x0 + w][FAB_SHADOW.min(axis=2) < FAB_MIN_TRANSMISSION] = 0
    # Rounded bottom corners of the frame.
    r = CORNER_RADIUS
    for cx in (INTERIOR_X0 + r, INTERIOR_X1 - 1 - r):
        cy = INTERIOR_Y1 - 1 - r
        corner = np.zeros_like(mask)
        x0, x1 = (INTERIOR_X0, cx) if cx < 540 else (cx, INTERIOR_X1)
        corner[cy:INTERIOR_Y1, x0:x1] = 1
        cv2.circle(corner, (cx, cy), r, 0, -1)
        mask[corner == 1] = 0
    return mask


def deshadow(img: np.ndarray) -> np.ndarray:
    """Undo the floating buttons' drop shadow (pixel = colour x transmission)."""
    out = img.copy()
    x0, y0 = FAB_SHADOW_ORIGIN
    h, w = FAB_SHADOW.shape[:2]
    t = FAB_SHADOW.astype(np.float32)
    region = out[y0:y0 + h, x0:x0 + w].astype(np.float32)
    fixed = np.clip(region * 255.0 / np.maximum(t, 1.0) + 0.5, 0, 255).astype(np.uint8)
    keep = (t.min(axis=2) >= FAB_MIN_TRANSMISSION)[..., None]
    out[y0:y0 + h, x0:x0 + w] = np.where(keep, fixed, out[y0:y0 + h, x0:x0 + w])
    return out


def edge_map(img: np.ndarray) -> np.ndarray:
    """Binary map of colour boundaries (room outlines, text, door ticks)."""
    f = img.astype(np.int16)
    gx = np.abs(np.diff(f, axis=1)).max(axis=2)
    gy = np.abs(np.diff(f, axis=0)).max(axis=2)
    e = np.zeros(img.shape[:2], np.uint8)
    e[:, 1:] |= (gx > 40).astype(np.uint8)
    e[1:, :] |= (gy > 40).astype(np.uint8)
    return e


def _xcorr(a: np.ndarray, b: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Full cross-correlation c[s] = sum_p a[p] * b[p - s] for every integer shift."""
    fa = np.fft.rfft2(a, shape)
    fb = np.fft.rfft2(b[::-1, ::-1], shape)
    return np.fft.irfft2(fa * fb, shape)


@dataclass
class Match:
    dx: int
    dy: int
    scale: float
    overlap_px: int
    edge_agreement: float
    matched_edges: int
    mismatch_fraction: float
    mean_abs_diff: float
    runner_up: dict | None = None
    notes: list[str] = field(default_factory=list)


def search_translation(a: np.ndarray, ma: np.ndarray, b: np.ndarray, mb: np.ndarray, factor: int = 4, keep: int = 8):
    """Exhaustively score every translation of b relative to a (coarse grid).

    Edges are dilated before downsampling so a 1px outline still lands on the
    same coarse cell whatever the sub-cell phase of the true shift. Score is
    the number of coinciding edge cells, weighted by edge agreement (how much
    of the edge content inside the overlap coincides at all).
    """
    k = np.ones((2 * factor + 1, 2 * factor + 1), np.uint8)
    ea = cv2.dilate(edge_map(a), k) * ma
    eb = cv2.dilate(edge_map(b), k) * mb

    def down(x):
        return cv2.resize(x.astype(np.float32), (x.shape[1] // factor, x.shape[0] // factor), interpolation=cv2.INTER_AREA)

    sa, sb, sma, smb = down(ea), down(eb), down(ma), down(mb)
    shape = (sa.shape[0] + sb.shape[0], sa.shape[1] + sb.shape[1])
    both = _xcorr(sa, sb, shape)
    only_a = _xcorr(sa, smb, shape)
    only_b = _xcorr(sma, sb, shape)
    overlap = _xcorr(sma, smb, shape)
    agreement = both / np.sqrt(np.maximum(only_a, 1e-3) * np.maximum(only_b, 1e-3))
    min_overlap = 0.02 * sma.sum()
    score = np.where((overlap > min_overlap) & (agreement > 0.3) & (both > 1), both * agreement ** 4, 0)
    flat = np.argsort(score, axis=None)[::-1]
    cands: list[tuple[int, int]] = []
    for idx in flat:
        if score.flat[idx] <= 0 or len(cands) >= keep:
            break
        iy, ix = np.unravel_index(idx, score.shape)
        # Index k in the full correlation corresponds to shift k - (len(b) - 1).
        dy = int(iy - (sb.shape[0] - 1)) * factor
        dx = int(ix - (sb.shape[1] - 1)) * factor
        if all(abs(dx - cx) > 3 * factor or abs(dy - cy) > 3 * factor for cx, cy in cands):
            cands.append((dx, dy))
    return cands


def overlap_stats(a, ma, b, mb, dx: int, dy: int) -> dict:
    """Pixel residual of b placed at (dx, dy) in a's frame, over the shared valid area."""
    h, w = a.shape[:2]
    hb, wb = b.shape[:2]
    x0, y0 = max(0, dx), max(0, dy)
    x1, y1 = min(w, dx + wb), min(h, dy + hb)
    if x1 <= x0 or y1 <= y0:
        return {"overlap_px": 0}
    pa = a[y0:y1, x0:x1].astype(np.int16)
    pb = b[y0 - dy:y1 - dy, x0 - dx:x1 - dx].astype(np.int16)
    valid = (ma[y0:y1, x0:x1] & mb[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).astype(bool)
    n = int(valid.sum())
    if n == 0:
        return {"overlap_px": 0}
    diff = np.abs(pa - pb).max(axis=2)
    ea = edge_map(a[y0:y1, x0:x1]).astype(bool) & valid
    eb = edge_map(b[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).astype(bool) & valid
    ea_d = cv2.dilate(ea.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    eb_d = cv2.dilate(eb.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    matched = int((ea & eb_d).sum())
    agreement = (ea & eb_d).sum() / max(1, ea.sum()) * ((eb & ea_d).sum() / max(1, eb.sum()))
    return {
        "overlap_px": n,
        "mismatch_fraction": float((diff[valid] > 60).mean()),
        "mean_abs_diff": float(diff[valid].mean()),
        "edges_a": int(ea.sum()),
        "edges_b": int(eb.sum()),
        "matched_edges": matched,
        "edge_agreement": float(np.sqrt(agreement)),
    }


def _mad(a, ma, b, mb, dx: int, dy: int) -> float:
    h, w = a.shape[:2]
    hb, wb = b.shape[:2]
    x0, y0, x1, y1 = max(0, dx), max(0, dy), min(w, dx + wb), min(h, dy + hb)
    if x1 <= x0 or y1 <= y0:
        return float("inf")
    valid = (ma[y0:y1, x0:x1] & mb[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).astype(bool)
    if not valid.any():
        return float("inf")
    d = cv2.absdiff(a[y0:y1, x0:x1], b[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).max(axis=2)
    return float(d[valid].mean())


def refine(a, ma, b, mb, dx: int, dy: int, radius: int) -> tuple[int, int, dict]:
    """Integer shift near (dx, dy) minimising the mean colour residual.

    Hill-climbs from the best point of a coarse lattice; the residual is
    unimodal within a couple of pixels of the true shift.
    """
    cache: dict[tuple[int, int], float] = {}

    def cost(x, y):
        if (x, y) not in cache:
            cache[(x, y)] = _mad(a, ma, b, mb, x, y)
        return cache[(x, y)]

    step = max(1, radius // 2)
    _, bx, by = min((cost(x, y), x, y) for y in range(dy - radius, dy + radius + 1, step) for x in range(dx - radius, dx + radius + 1, step))
    while True:
        _, nx, ny = min((cost(x, y), x, y) for y in (by - 1, by, by + 1) for x in (bx - 1, bx, bx + 1))
        if (nx, ny) == (bx, by):
            break
        bx, by = nx, ny
    return bx, by, overlap_stats(a, ma, b, mb, bx, by)


def accept(st: dict) -> bool:
    """A seam is proven when (almost) every edge in the overlap coincides and
    the colour residual is confined to anti-aliasing along outlines."""
    return st.get("overlap_px", 0) > 0 and st["edge_agreement"] > 0.9 and st["mismatch_fraction"] < 0.03 and st["matched_edges"] > 500
