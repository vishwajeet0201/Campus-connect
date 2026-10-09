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
    h, w = img.shape[:2]
    size = (round(w * scale), round(h * scale))
    out = cv2.resize(img, size, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    m = cv2.resize(mask, size, interpolation=cv2.INTER_NEAREST)
    return out, cv2.erode(m, np.ones((3, 3), np.uint8))


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
        if s != 1.0 and accept(sst) and (not accept(st) or sst["mismatch_fraction"] < 0.5 * st["mismatch_fraction"]):
            dx, dy, st, scale = sx, sy, sst, s
        else:
            scale = 1.0
        if accept(st):
            result = {"status": "proven", "scale": scale, "dx": dx, "dy": dy, "stats": st}
            rivals = [r for r in plausible[1:] if accept(r[2]) and (abs(r[0] - dx) > 8 or abs(r[1] - dy) > 8)]
            if rivals and rivals[0][2]["matched_edges"] > 0.5 * st["matched_edges"]:
                result["status"] = "ambiguous"
                result["rival"] = {"dx": rivals[0][0], "dy": rivals[0][1], "stats": rivals[0][2]}
            return result
    est = estimate_scale(a, ma, b, mb)
    if est and abs(est[0] - 1) > 0.005:
        # A clearly pinch-zoomed tile: locate it at the SIFT zoom, then let the
        # residual pick the exact zoom (the overlap must agree edge-for-edge).
        bs, mbs = rescale(b, mb, est[0])
        cands = search_translation(a, ma, bs, mbs, keep=3)
        best = None
        for dx, dy in cands:
            rx, ry, st = refine(a, ma, bs, mbs, dx, dy, 5)
            if best is None or st["matched_edges"] > best[2]["matched_edges"]:
                best = (rx, ry, st)
        if best:
            s, sx, sy, sst = sweep_scale(a, ma, b, mb, best[0], best[1], round(est[0], 3), 0.008, 0.001)
            s, sx, sy, sst = sweep_scale(a, ma, b, mb, sx, sy, s, 0.001, 0.00025)
            if accept(sst):
                return {"status": "proven", "scale": s, "dx": sx, "dy": sy, "stats": sst, "sift_inliers": est[1]}
            return {"status": "unresolved", "reason": f"zoomed tile (scale ~{est[0]:.3f}) did not verify", "best": {"scale": s, "dx": sx, "dy": sy, "stats": sst}}
    best = rows[0] if rows else None
    return {"status": "unresolved", "reason": "no translation makes the overlap agree", "best": best and {"dx": best[0], "dy": best[1], "stats": best[2]}}


def composite(images, masks, transforms):
    """Place every tile; each canvas pixel comes from the tile it sits deepest inside."""
    corners = []
    for img, (s, tx, ty) in zip(images, transforms):
        h, w = img.shape[:2]
        corners += [(tx, ty), (tx + w * s, ty + h * s)]
    xs, ys = zip(*corners)
    ox, oy = int(np.floor(min(xs))), int(np.floor(min(ys)))
    W, H = int(np.ceil(max(xs))) - ox + 1, int(np.ceil(max(ys))) - oy + 1
    canvas = np.full((H, W, 3), 255, np.uint8)
    best = np.zeros((H, W), np.float32)
    owner = np.full((H, W), -1, np.int16)
    for i, (img, mask, (s, tx, ty)) in enumerate(zip(images, masks, transforms)):
        M = np.float32([[s, 0, tx - ox], [0, s, ty - oy]])
        flags = cv2.INTER_NEAREST if s == 1.0 else cv2.INTER_CUBIC
        warped = cv2.warpAffine(img, M, (W, H), flags=flags, borderValue=(255, 255, 255))
        wm = cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
        if s != 1.0:
            wm = cv2.erode(wm, np.ones((3, 3), np.uint8))
        depth = cv2.distanceTransform(wm, cv2.DIST_L2, 5)
        # Upsampled (pinch-zoomed) tiles only fill what no native tile shows.
        if s > 1.0:
            depth = np.where(wm > 0, depth * 1e-3 + 1e-6, 0)
        take = depth > best
        canvas[take] = warped[take]
        best[take] = depth[take]
        owner[take] = i
    return canvas, owner, (ox, oy)


def consistency(images, masks, transforms, canvas, origin) -> list[dict]:
    """Compare every tile against the final composite over all its valid pixels."""
    ox, oy = origin
    H, W = canvas.shape[:2]
    out = []
    for img, mask, (s, tx, ty) in zip(images, masks, transforms):
        M = np.float32([[s, 0, tx - ox], [0, s, ty - oy]])
        flags = cv2.INTER_NEAREST if s == 1.0 else cv2.INTER_CUBIC
        warped = cv2.warpAffine(img, M, (W, H), flags=flags, borderValue=(255, 255, 255))
        wm = cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0).astype(bool)
        if s != 1.0:
            wm = cv2.erode(wm.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        diff = cv2.absdiff(warped, canvas).max(axis=2)[wm]
        ec = cv2.dilate(edge_map(canvas), np.ones((3, 3), np.uint8)).astype(bool)
        et = edge_map(warped).astype(bool) & wm
        out.append({
            "valid_px": int(wm.sum()),
            "mismatch_fraction": float((diff > 60).mean()),
            "edge_coverage": float((et & ec).sum() / max(1, et.sum())),
        })
    return out


def content_bbox(canvas, owner):
    covered = owner >= 0
    content = (canvas.min(axis=2) < 245) & covered
    ys, xs = np.where(content)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


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
    images = [deshadow(cv2.imread(str(p), cv2.IMREAD_COLOR)) for p in tiles]
    pill = header_bottom(images)
    mask = viewport_mask(pill)
    masks = [mask.copy() for _ in images]

    transforms = [(1.0, 0.0, 0.0)]
    seams = []
    for i in range(1, len(images)):
        key = f"{tiles[i - 1].name}->{tiles[i].name}"
        pinned = config.get("pinned", {}).get(key)
        if pinned:
            dx, dy = int(pinned["dx"]), int(pinned["dy"])
            # Axes the pixels *can* determine (e.g. dy across horizontal bands)
            # are refined by residual instead of trusting a hand-measured value.
            axes = pinned.get("refine", [])
            rng = range(-6, 7)
            cands = [(dx + (o if "dx" in axes else 0), dy + (o2 if "dy" in axes else 0)) for o in rng for o2 in rng]
            dx, dy = min(set(cands), key=lambda c: overlap_stats(images[i - 1], masks[i - 1], images[i], masks[i], *c).get("mean_abs_diff", 1e9))
            rel = {"status": "constrained", "scale": 1.0, "dx": dx, "dy": dy, "evidence": pinned["evidence"], "refined_axes": axes}
            rel["stats"] = overlap_stats(images[i - 1], masks[i - 1], images[i], masks[i], dx, dy)
            if rel["stats"].get("overlap_px", 0) and rel["stats"]["mismatch_fraction"] > 0.03:
                raise SystemExit(f"{key}: pinned offset contradicts the pixels (mismatch {rel['stats']['mismatch_fraction']:.3f})")
        else:
            rel = register(images[i - 1], masks[i - 1], images[i], masks[i])
            if rel["status"] == "unresolved":
                print(json.dumps({"seam": key, **rel}, indent=2, default=str))
                raise SystemExit(f"{key}: seam could not be proven; pin it in {args.folder / 'stitch.json'} with evidence")
            if rel["status"] == "ambiguous":
                print(json.dumps({"seam": key, **rel}, indent=2, default=str))
                raise SystemExit(f"{key}: two different offsets both fit; pin the correct one with evidence")
        # Tile i, scaled by rel.scale, sits at (dx, dy) in tile i-1's screen frame:
        # canvas = s_prev * (scale * p + d) + t_prev.
        s_prev, tx_prev, ty_prev = transforms[-1]
        transforms.append((s_prev * rel["scale"], tx_prev + s_prev * rel["dx"], ty_prev + s_prev * rel["dy"]))
        seams.append({"from": tiles[i - 1].name, "to": tiles[i].name, **rel})

    canvas, owner, origin = composite(images, masks, transforms)
    checks = consistency(images, masks, transforms, canvas, origin)
    x0, y0, x1, y1 = content_bbox(canvas, owner)
    m = CONTENT_MARGIN
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(canvas.shape[1], x1 + m), min(canvas.shape[0], y1 + m)
    # Pixels no screenshot shows are left transparent rather than guessed.
    covered = owner[y0:y1, x0:x1] >= 0
    out = np.dstack([canvas[y0:y1, x0:x1], np.where(covered, 255, 0).astype(np.uint8)])
    uncovered = float((~covered).mean())

    args.out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out / f"{args.name}.png"), out, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    ox, oy = origin
    layout = {
        "source": str(args.folder),
        "image": f"{args.name}.png",
        "size": [int(out.shape[1]), int(out.shape[0])],
        "tiles": [
            {"file": t.name, "scale": round(s, 5), "x": round(tx - ox - x0, 2), "y": round(ty - oy - y0, 2), **c}
            for t, (s, tx, ty), c in zip(tiles, transforms, checks)
        ],
        "seams": seams,
        "uncovered_fraction": round(uncovered, 4),
        **({"excluded_tiles": excluded} if excluded else {}),
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
        cv2.imwrite(str(args.debug / f"{args.name}-owners.png"), cv2.addWeighted(out, 0.6, tint.astype(np.uint8), 0.4, 0))
    summary = {"floor": args.name, "size": layout["size"], "seams": [(s["from"], s["to"], s["status"]) for s in seams], "excluded": sorted(excluded), "worst_tile_mismatch": max(c["mismatch_fraction"] for c in checks), "min_edge_coverage": min(c["edge_coverage"] for c in checks)}
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
