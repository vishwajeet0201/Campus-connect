"""Stitch one floor's screenshots into a single verified, non-repeating map.

Usage:
    python tools/mapstitch/stitch.py map-source/vjti-ground-floor --out public/maps --name vjti-G

Tiles are taken in serial order (numeric names, otherwise screenshot
timestamps). Each consecutive pair is registered exhaustively; a seam is only
accepted when the overlap agrees edge-for-edge. A pair that cannot be proven
from pixels (e.g. two views of one uniform band) must be pinned in the floor's
``stitch.json`` with the evidence for the chosen offset, and is reported as
"constrained" instead of "proven".
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mapstitch.core import (  # noqa: E402
    SCREEN_SHAPE,
    accept,
    deshadow,
    edge_map,
    header_bottom,
    list_tiles,
    overlap_stats,
    refine,
    search_translation,
    viewport_mask,
)

CONTENT_MARGIN = 24
CONTENT_MIN_AREA = 25  # px; smaller specks are noise, not map content
MIN_ZOOM = 0.0005  # a zoom smaller than this moves no pixel by more than ~0.5px across a screen
NATIVE_ZOOM_TOL = 0.0025  # chained zoom this close to 1 is measurement error (see snap_native_zoom)


def estimate_scale(a, ma, b, mb) -> tuple[float, int] | None:
    """Similarity scale of b relative to a from SIFT matches (None if unreliable)."""
    sift = cv2.SIFT_create(nfeatures=4000)
    ka, da = sift.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), ma)
    kb, db = sift.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), mb)
    if da is None or db is None or len(ka) < 10 or len(kb) < 10:
        return None
    pairs = cv2.BFMatcher().knnMatch(db, da, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.7 * n.distance]
    if len(good) < 12:
        return None
    src = np.float32([kb[m.queryIdx].pt for m in good])
    dst = np.float32([ka[m.trainIdx].pt for m in good])
    model, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if model is None or inliers.sum() < 12:
        return None
    scale = float(np.hypot(model[0, 0], model[1, 0]))
    return scale, int(inliers.sum())


def rescale(img, mask, scale: float):
    """img zoomed by exactly `scale` (fx/fy, not a rounded output size, so the
    zoom tested is the zoom reported). Pixel p lands at scale * p + zoom_offset(scale)."""
    out = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    m = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    return out, cv2.erode(m, np.ones((3, 3), np.uint8))


def zoom_offset(scale: float) -> float:
    """cv2.resize samples pixel centres: p -> scale * p + 0.5 * (scale - 1)."""
    return 0.5 * (scale - 1)


def place(b, mb, s: float, tx: float, ty: float, shape):
    """b and its mask zoomed by s with pixel p at s * p + (tx, ty), in a frame of
    `shape`, in one resampling (a second one would blur thin outlines twice).
    Shrinking first low-passes b about as much as area averaging would."""
    if s < 1:
        b = cv2.GaussianBlur(b, (0, 0), 0.29 / s)
    M = np.float32([[s, 0, tx], [0, s, ty]])
    h, w = shape[:2]
    out = cv2.warpAffine(b, M, (w, h), flags=cv2.INTER_LINEAR if s <= 1 else cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    m = cv2.warpAffine(mb, M, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    return out, cv2.erode(m, np.ones((3, 3), np.uint8))


def placed_stats(a, ma, b, mb, s: float, tx: float, ty: float) -> dict:
    """overlap_stats for b zoomed by s with its pixel p at s * p + (tx, ty) in a."""
    bw, mbw = place(b, mb, s, tx, ty, a.shape)
    return overlap_stats(a, ma, bw, mbw, 0, 0)


def zoom_normals(a, ma, bw, mbw, cell: int = 64):
    """Gauss-Newton normal equations for the residual offset of placed bw
    against a, modelled as k * (position - centre) + (ux, uy). Each colour
    channel contributes on its own: this map's fills (blue rooms, tan paths,
    green fields) are almost the same grey, so only colour sees the boundaries
    between them. Straight edges constrain only across themselves, corners and
    glyphs both ways. Returns the equations summed per 64px cell (to bootstrap)
    and per channel (to compare), and the centre."""
    valid = cv2.erode(((ma > 0) & (mbw > 0)).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    fa = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 1.5)
    fb = cv2.GaussianBlur(bw.astype(np.float32), (0, 0), 1.5)
    valid &= np.abs(fa - fb).max(axis=2) < 60  # not a feature one tile lacks (e.g. a shadow remnant)
    ys, xs = np.nonzero(valid)
    if len(xs) < 1000:
        return None
    cx, cy = float(xs.mean()), float(ys.mean())
    cells = (ys // cell) * (a.shape[1] // cell + 1) + xs // cell
    order = np.argsort(cells)
    groups = np.split(order, np.flatnonzero(np.diff(cells[order])) + 1)
    per_cell = [[np.zeros((3, 3)), np.zeros(3)] for _ in groups]
    per_channel = []
    for c in range(3):
        gb = fb[..., c]
        gx = cv2.Sobel(gb, cv2.CV_32F, 1, 0, ksize=1, scale=0.5)[ys, xs].astype(np.float64)
        gy = cv2.Sobel(gb, cv2.CV_32F, 0, 1, ksize=1, scale=0.5)[ys, xs].astype(np.float64)
        e = (fa[..., c] - gb)[ys, xs].astype(np.float64)
        J = np.stack([gx * (xs - cx) + gy * (ys - cy), gx, gy], axis=1)
        per_channel.append((J.T @ J, J.T @ e))
        for acc, idx in zip(per_cell, groups):
            acc[0] += J[idx].T @ J[idx]
            acc[1] += J[idx].T @ e[idx]
    normals = [(n, r) for n, r in per_cell if np.trace(n) > 0]
    return normals, (cx, cy), per_channel


def solve_normals(normals):
    N = sum(n for n, _ in normals)
    r = sum(v for _, v in normals)
    return np.linalg.solve(N + 1e-9 * np.eye(3) * np.trace(N), r)


def refine_zoom(a, ma, b, mb, s: float, dx: int, dy: int) -> dict:
    """Sub-pixel zoom and shift for b, from the integer-shift sweep's best (b
    zoomed by s at (dx, dy)). An integer shift can't follow the drift a 0.1%
    zoom error causes across the overlap, so the sweep alone doesn't pin the
    zoom. Gauss-Newton over every overlap pixel fits the remaining offset as
    one zoom + shift, re-placing b until it stops moving; the fit replaces the
    sweep unless only the sweep passes the proof test. Its zoom uncertainty
    comes from a bootstrap over 64px cells of the overlap."""
    o = zoom_offset(s)
    tx, ty = dx + o, dy + o
    swept = {"scale": s, "dx": tx, "dy": ty, "stats": placed_stats(a, ma, b, mb, s, tx, ty)}
    for _ in range(20):
        bw, mbw = place(b, mb, s, tx, ty, a.shape)
        got = zoom_normals(a, ma, bw, mbw)
        if got is None or len(got[0]) < 8:
            return swept
        normals, (cx, cy), per_channel = got
        k, ux, uy = solve_normals(normals)
        if abs(k) > 0.01 or abs(ux) > 5 or abs(uy) > 5:
            return swept  # diverging: the start wasn't close enough
        # bw's content sits k * (x - c) + u away from a's: move it back.
        tx, ty = (1 - k) * tx + k * cx - ux, (1 - k) * ty + k * cy - uy
        s *= 1 - k
        if abs(k) < 3e-5 and abs(ux) < 0.01 and abs(uy) < 0.01:
            break  # at the noise floor of re-placing
    else:
        return swept
    # The fit is judged by the proof test alone: colour residuals can't compare
    # placements at different sub-pixel phases (interpolation blur lowers them).
    st = placed_stats(a, ma, b, mb, s, tx, ty)
    if accept(swept["stats"]) and not accept(st):
        return swept
    # Two views of the zoom's uncertainty: a bootstrap over overlap cells
    # (neighbouring cells share features, so it runs small) and how far each
    # colour channel alone would move it (sensitive to which features carry
    # the fit). The larger is the honest one.
    rng = np.random.default_rng(0)
    boot = [solve_normals([normals[i] for i in rng.integers(0, len(normals), len(normals))])[0] for _ in range(200)]
    by_channel = []
    for n, r in per_channel:
        try:
            by_channel.append(solve_normals([(n, r)])[0])
        except np.linalg.LinAlgError:
            continue
    sd = float(np.std(boot) * s)
    spread = float((max(by_channel) - min(by_channel)) * s) if len(by_channel) > 1 else 0.0
    return {"scale": float(s), "dx": float(tx), "dy": float(ty), "stats": st, "zoom_fit": {
        "method": "Gauss-Newton fit of zoom + shift over the overlap's pixels (colour)",
        "swept_scale": swept["scale"], "cells": len(normals), "scale_sd": round(sd, 6),
        "channel_spread": round(spread, 6), "uncertainty": round(max(sd, spread / 2), 6)}}


def sweep_scale(a, ma, b, mb, dx: int, dy: int, centre: float, span: float, step: float):
    """Re-register b at zoom factors around `centre`; returns the lowest-residual
    (scale, dx, dy, stats). The shift is re-predicted for each zoom so the
    middle of the overlap stays put."""
    hb, wb = b.shape[:2]
    # Middle of the overlap in b's unscaled pixel frame.
    cx = (max(0, dx) + min(a.shape[1], dx + wb * centre)) / 2
    cy = (max(0, dy) + min(a.shape[0], dy + hb * centre)) / 2
    bx, by = (cx - dx) / centre, (cy - dy) / centre
    best = None
    for s in np.arange(centre - span, centre + span + step / 2, step):
        s = float(round(s, 5))
        bs, mbs = (b, mb) if s == 1.0 else rescale(b, mb, s)
        px, py = round(cx - s * bx), round(cy - s * by)
        rx, ry, st = refine(a, ma, bs, mbs, px, py, 4)
        if best is None or st.get("mean_abs_diff", 1e9) < best[3].get("mean_abs_diff", 1e9):
            best = (s, rx, ry, st)
    return best


def register(a, ma, b, mb) -> dict:
    """Relative placement of b in a's (unscaled) pixel frame."""
    cands = search_translation(a, ma, b, mb)
    rows = [refine(a, ma, b, mb, dx, dy, 5) for dx, dy in cands]
    plausible = sorted((r for r in rows if r[2].get("edge_agreement", 0) > 0.6), key=lambda r: -r[2]["matched_edges"])
    if plausible:
        dx, dy, st = plausible[0]
        # Screenshots are occasionally pinch-zoomed by a fraction of a percent,
        # which a pure translation only half explains. Sweep the zoom and keep
        # it only when it clearly beats 1.0.
        s, sx, sy, sst = sweep_scale(a, ma, b, mb, dx, dy, 1.0, 0.012, 0.001)
        s, sx, sy, sst = sweep_scale(a, ma, b, mb, sx, sy, s, 0.001, 0.00025) if s != 1.0 else (s, sx, sy, sst)
        zoom = refine_zoom(a, ma, b, mb, s, sx, sy) if s != 1.0 else {"stats": {}}
        # Keep a zoom only if it is really there: clearly away from 1 given its
        # fit's uncertainty (residuals can't judge it: interpolating a
        # fractional placement smooths away anti-aliasing differences).
        sd = (zoom.get("zoom_fit") or {}).get("uncertainty") or 0
        real = "zoom_fit" in zoom and abs(zoom["scale"] - 1) > max(MIN_ZOOM, 3 * sd)
        if accept(zoom["stats"]) and (real or not accept(st)):
            dx, dy, st, scale = zoom.pop("dx"), zoom.pop("dy"), zoom.pop("stats"), zoom.pop("scale")
        else:
            zoom, scale = {}, 1.0
        if accept(st):
            result = {"status": "proven", "scale": scale, "dx": dx, "dy": dy, "stats": st, **zoom}
            # A rival offset is a real alternative only if it fits about as well
            # pixel for pixel; along uniform bands, shifted offsets match the
            # band edges but not the labels drawn on them.
            bad = lambda stats: stats["mismatch_fraction"] * stats["overlap_px"]  # noqa: E731
            others = [r for r in plausible[1:] if abs(r[0] - dx) > 8 or abs(r[1] - dy) > 8]
            if scale != 1.0:
                # Judge rivals the way the winner was judged: at its zoom, sub-pixel.
                rescored = []
                for rx, ry, _ in others:
                    _, sx2, sy2, _ = sweep_scale(a, ma, b, mb, rx, ry, scale, 0.0, 1.0)
                    z = refine_zoom(a, ma, b, mb, scale, sx2, sy2)
                    rescored.append((z["dx"], z["dy"], z["stats"]))
                others = [r for r in rescored if abs(r[0] - dx) > 8 or abs(r[1] - dy) > 8]
            rivals = [r for r in others if accept(r[2]) and r[2]["matched_edges"] > 0.5 * st["matched_edges"]
                      and bad(r[2]) <= 1.5 * bad(st) + 50]
            if rivals:
                result["status"] = "ambiguous"
                result["rival"] = {"dx": rivals[0][0], "dy": rivals[0][1], "stats": rivals[0][2]}
            return result
    est = estimate_scale(a, ma, b, mb)
    unresolved = {"status": "unresolved", "reason": "no translation makes the overlap agree", "best": rows and {"dx": rows[0][0], "dy": rows[0][1], "stats": rows[0][2]}}
    if est and est[0] > 1.05:
        # b shows the map smaller (zoomed out, or a downscaled upload). Verify in
        # b's coarser frame by shrinking a, rather than judging edges on an
        # upsampled, blurrier b; then express the result in a's frame.
        inv = _register_zoomed(b, mb, a, ma, (1 / est[0], est[1]))
        if inv is None or inv["status"] != "proven":
            return inv or unresolved
        s = inv["scale"]
        out = {**inv, "scale": 1 / s, "dx": -inv["dx"] / s, "dy": -inv["dy"] / s, "verified_in": "the zoomed-out tile's frame"}
        if inv.get("zoom_fit"):
            z = dict(inv["zoom_fit"])
            z["swept_scale"] = 1 / z["swept_scale"]
            for key in ("scale_sd", "channel_spread", "uncertainty"):
                z[key] = round(z[key] / s ** 2, 6)  # d(1/s) = ds / s^2
            out["zoom_fit"] = z
        return out
    if est and abs(est[0] - 1) > 0.005:
        return _register_zoomed(a, ma, b, mb, est) or unresolved
    return unresolved


def _register_zoomed(a, ma, b, mb, est) -> dict | None:
    """Place b, which is at a clearly different zoom (est = (scale, SIFT inliers)):
    locate it at the SIFT zoom, then let the residual pick the exact zoom (the
    overlap must agree edge-for-edge)."""
    bs, mbs = rescale(b, mb, est[0])
    best = None
    for dx, dy in search_translation(a, ma, bs, mbs, keep=3):
        rx, ry, st = refine(a, ma, bs, mbs, dx, dy, 5)
        if best is None or st["matched_edges"] > best[2]["matched_edges"]:
            best = (rx, ry, st)
    if not best:
        return None
    s, sx, sy, sst = sweep_scale(a, ma, b, mb, best[0], best[1], round(est[0], 3), 0.008, 0.001)
    s, sx, sy, sst = sweep_scale(a, ma, b, mb, sx, sy, s, 0.001, 0.00025)
    # The sweep's shifts are whole pixels; at a large zoom difference half a
    # pixel decides the edge test, so judge the sub-pixel fit.
    zoom = refine_zoom(a, ma, b, mb, s, sx, sy)
    if accept(zoom["stats"]):
        return {"status": "proven", **zoom, "sift_inliers": est[1]}
    return {"status": "unresolved", "reason": f"zoomed tile (scale ~{est[0]:.3f}) did not verify", "best": {k: zoom[k] for k in ("scale", "dx", "dy", "stats")}}


def seam_check(images, masks, transforms, j: int, i: int) -> dict:
    """Overlap stats of tiles j and i under the given canvas transforms, in the
    coarser of their two frames."""
    (sj, xj, yj), (si, xi, yi) = transforms[j], transforms[i]
    s, tx, ty = si / sj, (xi - xj) / sj, (yi - yj) / sj
    if s <= 1:
        return placed_stats(images[j], masks[j], images[i], masks[i], s, tx, ty)
    return placed_stats(images[i], masks[i], images[j], masks[j], 1 / s, -tx / s, -ty / s)


def snap_native_zoom(images, masks, transforms, tiles, seams, resampled) -> dict:
    """A native screenshot whose chained zoom comes out within NATIVE_ZOOM_TOL of
    1 (e.g. one reached through a zoomed bridging tile, whose zoom the overlap
    only pins to ~0.1%) is placed at zoom 1, pixel for pixel, anchored on its
    seam overlap, if every seam it is part of still proves. Modifies
    transforms in place; returns {tile index: {zoom before, re-verified seams}}."""
    index = {t.name: k for k, t in enumerate(tiles)}
    snapped = {}
    for i, (s, tx, ty) in enumerate(transforms):
        if s == 1.0 or abs(s - 1) > NATIVE_ZOOM_TOL or tiles[i].name in resampled:
            continue
        links = [(index[q["from"]], index[q["to"]]) for q in seams if q["status"] == "proven" and tiles[i].name in (q["from"], q["to"])]
        parent = next((index[q["from"]] for q in seams if q["to"] == tiles[i].name), None)
        # Only a zoom inherited through a non-native tile (a resampled or zoomed
        # bridge) is suspect; a zoom measured against a native neighbour is real.
        if not links or parent is None or (tiles[parent].name not in resampled and transforms[parent][0] == 1.0):
            continue
        # Keep the middle of the overlap with the tile it was placed against fixed.
        j = parent
        sj, xj, yj = transforms[j]
        hi, wi = images[i].shape[:2]
        hj, wj = images[j].shape[:2]
        cx = (max(tx, xj) + min(tx + wi * s, xj + wj * sj)) / 2
        cy = (max(ty, yj) + min(ty + hi * s, yj + hj * sj)) / 2
        trial = list(transforms)
        trial[i] = (1.0, cx - (cx - tx) / s, cy - (cy - ty) / s)
        checks = {f"{tiles[a].name}->{tiles[b].name}": seam_check(images, masks, trial, a, b) for a, b in links}
        if all(accept(st) for st in checks.values()):
            transforms[i] = trial[i]
            snapped[i] = {"zoom_before": round(s, 6), "reverified": checks}
    return snapped


def warp_tile(img, mask, s: float, tx: float, ty: float, W: int, H: int):
    """A tile and its mask on the canvas, resampled the way place() verified it."""
    M = np.float32([[s, 0, tx], [0, s, ty]])
    if s == 1.0:
        flags = cv2.INTER_NEAREST
    elif s < 1:
        img, flags = cv2.GaussianBlur(img, (0, 0), 0.29 / s), cv2.INTER_LINEAR
    else:
        flags = cv2.INTER_CUBIC
    warped = cv2.warpAffine(img, M, (W, H), flags=flags, borderValue=(255, 255, 255))
    wm = cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    return warped, (wm if s == 1.0 else cv2.erode(wm, np.ones((3, 3), np.uint8)))


def composite(images, masks, transforms, low_priority=()):
    """Place every tile; each canvas pixel comes from the tile it sits deepest inside.
    Priority goes by where a tile came from: native screenshots at their own zoom
    first, then zoomed-out (upsampled) ones, and screenshots that arrived
    downscaled (low_priority) only fill what nothing else shows."""
    corners = []
    for img, (s, tx, ty) in zip(images, transforms):
        h, w = img.shape[:2]
        corners += [(tx, ty), (tx + w * s, ty + h * s)]
    xs, ys = zip(*corners)
    ox, oy = int(np.floor(min(xs))), int(np.floor(min(ys)))
    W, H = int(np.ceil(max(xs))) - ox + 1, int(np.ceil(max(ys))) - oy + 1
    canvas = np.full((H, W, 3), 255, np.uint8)
    best = np.zeros((H, W), np.float64)
    owner = np.full((H, W), -1, np.int16)
    for i, (img, mask, (s, tx, ty)) in enumerate(zip(images, masks, transforms)):
        warped, wm = warp_tile(img, mask, s, tx - ox, ty - oy, W, H)
        # Class first, then depth: depth (< 1e5 px) never outranks a better class.
        rank = 0 if i in low_priority else (1 if s > 1.0 else 2)
        depth = np.where(wm > 0, cv2.distanceTransform(wm, cv2.DIST_L2, 5) + 1 + rank * 1e5, 0)
        take = depth > best
        canvas[take] = warped[take]
        best[take] = depth[take]
        owner[take] = i
    return canvas, owner, (ox, oy)


def consistency(images, masks, transforms, canvas, owner, origin) -> list[dict]:
    """Compare every tile with the final composite where other tiles were
    drawn (where it was drawn itself, it can only agree)."""
    ox, oy = origin
    H, W = canvas.shape[:2]
    ec = cv2.dilate(edge_map(canvas), np.ones((3, 3), np.uint8)).astype(bool)
    out = []
    for i, (img, mask, (s, tx, ty)) in enumerate(zip(images, masks, transforms)):
        warped, wm = warp_tile(img, mask, s, tx - ox, ty - oy, W, H)
        wm = cv2.erode(wm, np.ones((5, 5), np.uint8)).astype(bool)
        shared = wm & (owner >= 0) & (owner != i)
        if not shared.any():
            out.append({"valid_px": int(wm.sum()), "compared_px": 0, "mismatch_fraction": None, "edge_coverage": None})
            continue
        diff = cv2.absdiff(warped, canvas).max(axis=2)[shared]
        et = edge_map(warped).astype(bool) & shared
        out.append({
            "valid_px": int(wm.sum()),
            "compared_px": int(shared.sum()),
            "mismatch_fraction": float((diff > 60).mean()),
            "edge_coverage": float((et & ec).sum() / max(1, et.sum())),
        })
    return out


def find_open_edges(image, covered) -> list[dict]:
    """Drawn content that runs into an area no screenshot shows: the map goes
    on there, so the floor is incomplete at that edge."""
    content = (image.min(axis=2) < 235) & covered
    unseen = cv2.dilate((~covered).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    touch = (content & unseen).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(touch, np.ones((9, 9), np.uint8)), connectivity=8)
    H, W = covered.shape
    edges = []
    for x, y, w, h, area in stats[1:]:
        if area < 60:
            continue
        side = min((("left", x), ("right", W - x - w), ("top", y), ("bottom", H - y - h)), key=lambda t: t[1])[0]
        edges.append({"side": side, "bbox": [int(x), int(y), int(w), int(h)]})
    return edges


def content_bbox(canvas, owner, min_area=CONTENT_MIN_AREA):
    """Bounding box of drawn content. Specks smaller than min_area pixels (JPEG
    and resampling noise in near-white background) don't count; real marks,
    down to 1px outlines and single glyphs, are larger."""
    covered = owner >= 0
    content = ((canvas.min(axis=2) < 245) & covered).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(content, connectivity=8)
    keep = stats[1:][stats[1:, cv2.CC_STAT_AREA] >= min_area]
    if not len(keep):
        keep = stats[1:]  # nothing but specks: keep them rather than crop to nothing
    if not len(keep):
        raise SystemExit("the stitched canvas has no drawn content")
    x0, y0 = keep[:, cv2.CC_STAT_LEFT].min(), keep[:, cv2.CC_STAT_TOP].min()
    x1 = (keep[:, cv2.CC_STAT_LEFT] + keep[:, cv2.CC_STAT_WIDTH]).max()
    y1 = (keep[:, cv2.CC_STAT_TOP] + keep[:, cv2.CC_STAT_HEIGHT]).max()
    return int(x0), int(y0), int(x1), int(y1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", type=Path, required=True, help="directory for <name>.png and <name>.layout.json")
    ap.add_argument("--name", required=True)
    ap.add_argument("--reports", type=Path, help="directory for <name>.layout.json (default: --out)")
    ap.add_argument("--debug", type=Path, help="optional directory for seam/ownership debug images")
    args = ap.parse_args()

    config = json.loads((args.folder / "stitch.json").read_text()) if (args.folder / "stitch.json").exists() else {}
    excluded = config.get("exclude", {})
    tiles = [t for t in list_tiles(args.folder) if t.name not in excluded]
    images, resampled = [], {}
    for path in tiles:
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        if (h, w) != SCREEN_SHAPE:
            # Screenshots that were downscaled on the way here (e.g. by a chat
            # upload) are brought back to the phone's resolution; they keep a
            # low priority in the composite and are flagged in the report.
            if abs(w / h - SCREEN_SHAPE[1] / SCREEN_SHAPE[0]) > 0.005:
                raise SystemExit(f"{path.name}: {w}x{h} is not a {SCREEN_SHAPE[1]}x{SCREEN_SHAPE[0]} screenshot")
            img = cv2.resize(img, (SCREEN_SHAPE[1], SCREEN_SHAPE[0]), interpolation=cv2.INTER_LANCZOS4)
            resampled[path.name] = [w, h]
        images.append(deshadow(img))
    pill = header_bottom(images)
    mask = viewport_mask(pill)
    masks = [mask.copy() for _ in images]

    def pinned_seam(a: int, b: int):
        pin = config.get("pinned", {}).get(f"{tiles[a].name}->{tiles[b].name}")
        if not pin:
            return None
        dx, dy = int(pin["dx"]), int(pin["dy"])
        # Axes the pixels *can* determine (e.g. dy across horizontal bands)
        # are refined by residual instead of trusting a hand-measured value.
        axes = pin.get("refine", [])
        rng = range(-6, 7)
        cands = {(dx + (o if "dx" in axes else 0), dy + (o2 if "dy" in axes else 0)) for o in rng for o2 in rng}
        dx, dy = min(cands, key=lambda c: overlap_stats(images[a], masks[a], images[b], masks[b], *c).get("mean_abs_diff", 1e9))
        rel = {"status": "constrained", "scale": 1.0, "dx": dx, "dy": dy, "evidence": pin["evidence"], "refined_axes": axes}
        rel["stats"] = overlap_stats(images[a], masks[a], images[b], masks[b], dx, dy)
        if rel["stats"].get("overlap_px", 0) and rel["stats"]["mismatch_fraction"] > 0.03:
            raise SystemExit(f"{tiles[a].name}->{tiles[b].name}: pinned offset contradicts the pixels (mismatch {rel['stats']['mismatch_fraction']:.3f})")
        return rel

    # Place tiles in serial order, each against its predecessor first. A tile
    # that doesn't overlap its predecessor (e.g. a later screenshot that bridges
    # two earlier ones) is tried against every placed tile, and anything still
    # unplaced is retried once more tiles are down.
    transforms: dict[int, tuple[float, float, float]] = {0: (1.0, 0.0, 0.0)}
    seams = []
    pending = list(range(1, len(images)))
    failures: dict[str, dict] = {}
    while pending:
        progressed = False
        for i in list(pending):
            for j in sorted(transforms, key=lambda j: (j != i - 1, -j)):
                key = f"{tiles[j].name}->{tiles[i].name}"
                if key in failures:
                    continue
                rel = pinned_seam(j, i) or register(images[j], masks[j], images[i], masks[i])
                if rel["status"] == "ambiguous":
                    print(json.dumps({"seam": key, **rel}, indent=2, default=str))
                    raise SystemExit(f"{key}: two different offsets both fit; pin the correct one with evidence")
                if rel["status"] == "unresolved":
                    failures[key] = rel
                    continue
                # Tile i, scaled by rel.scale, sits at (dx, dy) in tile j's screen
                # frame: canvas = s_j * (scale * p + d) + t_j.
                s_j, tx_j, ty_j = transforms[j]
                transforms[i] = (s_j * rel["scale"], tx_j + s_j * rel["dx"], ty_j + s_j * rel["dy"])
                seams.append({"from": tiles[j].name, "to": tiles[i].name, **rel})
                pending.remove(i)
                progressed = True
                break
        if not progressed:
            for key, rel in failures.items():
                print(json.dumps({"seam": key, **rel}, default=str)[:600])
            raise SystemExit(f"cannot place {[tiles[i].name for i in pending]}: no proven seam to any placed tile; pin one in {args.folder / 'stitch.json'} with evidence")
    transforms = [transforms[i] for i in range(len(images))]
    snapped = snap_native_zoom(images, masks, transforms, tiles, seams, resampled)
    index = {t.name: k for k, t in enumerate(tiles)}
    for q in seams:
        # A snapped tile's seam no longer chains to where it was drawn: record both.
        j, i = index[q["from"]], index[q["to"]]
        if i in snapped or j in snapped:
            (sj, xj, yj), (si, xi, yi) = transforms[j], transforms[i]
            q["after_native_zoom_snap"] = {"scale": si / sj, "dx": (xi - xj) / sj, "dy": (yi - yj) / sj}

    low = {i for i, t in enumerate(tiles) if t.name in resampled}
    canvas, owner, origin = composite(images, masks, transforms, low)
    checks = consistency(images, masks, transforms, canvas, owner, origin)
    x0, y0, x1, y1 = content_bbox(canvas, owner)
    m = CONTENT_MARGIN
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(canvas.shape[1], x1 + m), min(canvas.shape[0], y1 + m)
    # Pixels no screenshot shows are left transparent rather than guessed.
    covered = owner[y0:y1, x0:x1] >= 0
    out = np.dstack([canvas[y0:y1, x0:x1], np.where(covered, 255, 0).astype(np.uint8)])
    uncovered = float((~covered).mean())
    open_edges = find_open_edges(out[..., :3], covered)

    args.out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out / f"{args.name}.png"), out, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    ox, oy = origin
    layout = {
        "source": str(args.folder),
        "image": f"{args.name}.png",
        "size": [int(out.shape[1]), int(out.shape[0])],
        "tiles": [
            {"file": t.name, "scale": round(s, 5), "x": round(tx - ox - x0, 2), "y": round(ty - oy - y0, 2), **c,
             **({"native_zoom_snap": snapped[i]} if i in snapped else {})}
            for i, (t, (s, tx, ty), c) in enumerate(zip(tiles, transforms, checks))
        ],
        "seams": seams,
        "uncovered_fraction": round(uncovered, 4),
        "open_edges": open_edges,
        **({"excluded_tiles": excluded} if excluded else {}),
        **({"resampled_tiles": {name: f"received at {w}x{h}, resampled to {SCREEN_SHAPE[1]}x{SCREEN_SHAPE[0]}" for name, (w, h) in resampled.items()}} if resampled else {}),
    }
    reports = args.reports or args.out
    reports.mkdir(parents=True, exist_ok=True)
    (reports / f"{args.name}.layout.json").write_text(json.dumps(layout, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o)) + "\n")
    if args.debug:
        args.debug.mkdir(parents=True, exist_ok=True)
        rng = np.random.default_rng(7)
        colours = rng.integers(60, 255, (len(images) + 1, 3)).astype(np.uint8)
        own = owner[y0:y1, x0:x1]
        tint = np.where(own[..., None] >= 0, colours[own], 0)
        cv2.imwrite(str(args.debug / f"{args.name}-owners.png"), cv2.addWeighted(out[..., :3], 0.6, tint.astype(np.uint8), 0.4, 0))
    summary = {"floor": args.name, "size": layout["size"], "seams": [(s["from"], s["to"], s["status"]) for s in seams], "excluded": sorted(excluded), "worst_tile_mismatch": max((c["mismatch_fraction"] for c in checks if c["mismatch_fraction"] is not None), default=0.0), "min_edge_coverage": min((c["edge_coverage"] for c in checks if c["edge_coverage"] is not None), default=1.0), "open_edges": len(open_edges)}
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
