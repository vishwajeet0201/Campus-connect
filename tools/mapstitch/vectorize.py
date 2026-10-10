"""Turn a stitched floor image into vector features.

The source app draws every floor with a small flat palette, so each feature
class can be recovered exactly from colour:

    rooms #BFE4FF, corridors #F3DBAB, open areas #FFEED0, playing field #B2FF9F,
    garden #3EAF23, gates #726FFE, stairs #F26061, background #FFFFFF.

Room outlines, labels and door ticks are dark "ink". Door ticks are the short,
thick bars drawn across a room's outline; they are told apart from 1px
outlines and text strokes by their thickness and shape.

Usage:
    python tools/mapstitch/vectorize.py public/maps/stitched/vjti-G.png --out build/vjti-G.features.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

PALETTE = {
    "white": (0xFF, 0xFF, 0xFF),
    "room": (0xBF, 0xE4, 0xFF),
    "open": (0xFF, 0xEE, 0xD0),
    "corridor": (0xF3, 0xDB, 0xAB),
    "field": (0xB2, 0xFF, 0x9F),
    "garden": (0x3E, 0xAF, 0x23),
    "gate": (0x72, 0x6F, 0xFE),
    "stairs": (0xF2, 0x60, 0x61),
    "service": (0xDF, 0xED, 0xF8),
}
CLASSES = list(PALETTE)
INK = len(CLASSES)          # outlines, text, door ticks
MIXED = len(CLASSES) + 1    # anti-aliased blends
UNCOVERED = len(CLASSES) + 2


def classify(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[..., :3][..., ::-1].astype(np.int16)
    best = np.full(rgb.shape[:2], 10_000, np.int16)
    cls = np.full(rgb.shape[:2], MIXED, np.uint8)
    for i, name in enumerate(CLASSES):
        d = np.abs(rgb - np.array(PALETTE[name], np.int16)).max(axis=2)
        take = (d < best) & (d <= 18)
        best[take] = d[take]
        cls[take] = i
    lum = rgb.mean(axis=2)
    cls[(cls == MIXED) & (lum < 150)] = INK
    if rgba.shape[2] == 4:
        cls[rgba[..., 3] == 0] = UNCOVERED
    return cls


def polygon(mask: np.ndarray, eps: float = 1.2) -> list[list[list[int]]]:
    """Outer rings and holes of a binary mask as integer polygons."""
    contours, hierarchy = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    rings = []
    for c in contours:
        if cv2.contourArea(c) < 30:
            continue
        a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        rings.append(a.tolist())
    return rings


def components(mask: np.ndarray, min_area: int, conn: int = 4):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=conn)
    for i in range(1, n):
        x, y, w, h, a = (int(v) for v in stats[i])
        if a >= min_area:
            yield i, lab, (x, y, w, h), a


def fill_holes(mask: np.ndarray) -> np.ndarray:
    m = mask.astype(np.uint8)
    h, w = m.shape
    flood = np.zeros((h + 2, w + 2), np.uint8)
    inv = (1 - m).copy()
    cv2.floodFill(inv, flood, (0, 0), 0)
    return (m | inv).astype(bool)


def extract(path: Path, with_maps: bool = False):
    """Feature dict; with_maps=True also returns (class map, room-id map)."""
    rgba = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if rgba.shape[2] == 3:
        rgba = np.dstack([rgba, np.full(rgba.shape[:2], 255, np.uint8)])
    cls = classify(rgba)
    H, W = cls.shape
    ink = cls == INK
    feats: dict = {"size": [W, H], "rooms": [], "areas": [], "gates": [], "stairs": [], "doors": [], "texts": []}

    # Rooms: 4-connected room-blue regions; outlines (ink) separate neighbours.
    room_id = np.zeros((H, W), np.int32)
    for i, lab, (x, y, w, h), a in components(cls == CLASSES.index("room"), 300):
        comp = lab[y:y + h, x:x + w] == i
        solid = fill_holes(np.pad(comp, 1))[1:-1, 1:-1]
        # Door ticks drawn across the outline notch the room by a few px;
        # close those before judging whether the room is a plain rectangle.
        closed = cv2.morphologyEx(np.pad(solid, 6).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))[6:-6, 6:-6].astype(bool)
        rect_fill = closed.sum() / (w * h)
        rid = len(feats["rooms"]) + 1
        room_id[y:y + h, x:x + w][solid] = rid
        # Grow by 1px so the shape takes in its own outline.
        full = np.zeros((H, W), np.uint8)
        full[y:y + h, x:x + w] = closed
        full = cv2.dilate(full, np.ones((3, 3), np.uint8))
        feats["rooms"].append({
            "id": rid,
            "bbox": [x, y, w, h],
            "area": int(solid.sum()),
            "rect": bool(rect_fill > 0.985),
            "polygon": polygon(full) if rect_fill <= 0.985 else None,
        })

    # Open areas, corridors, field, garden, service (light) blocks.
    for name in ("open", "corridor", "field", "garden", "service"):
        m = cls == CLASSES.index(name)
        for i, lab, (x, y, w, h), a in components(m, 400, 8):
            comp = np.zeros((H, W), bool)
            comp[y:y + h, x:x + w] = lab[y:y + h, x:x + w] == i
            # Anti-aliased blends along outlines form 1-2px slivers.
            if min(w, h) < 6 or cv2.distanceTransform(np.pad(comp[y:y + h, x:x + w], 1).astype(np.uint8), cv2.DIST_L2, 3).max() < 3:
                continue
            feats["areas"].append({"kind": name, "bbox": [x, y, w, h], "area": int(a), "rings": polygon(fill_holes(comp))})

    for i, lab, (x, y, w, h), a in components(cls == CLASSES.index("gate"), 200, 8):
        feats["gates"].append({"bbox": [x, y, w, h]})

    # Stairs: red treads with dark tread lines; merge them before measuring.
    red = cv2.morphologyEx((cls == CLASSES.index("stairs")).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    for i, lab, (x, y, w, h), a in components(red, 120, 8):
        if min(w, h) >= 25:  # smaller red marks are glyphs (e.g. the quad's heart)
            m = np.zeros((H, W), np.uint8)
            m[y:y + h, x:x + w] = lab[y:y + h, x:x + w] == i
            feats["stairs"].append({"bbox": [x, y, w, h], "rings": polygon(fill_holes(m))})

    # Door ticks: ink that survives an opening wider than an outline / glyph stroke.
    thick = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    for i, lab, (x, y, w, h), a in components(thick, 20, 8):
        long_, short = max(w, h), min(w, h)
        # Door ticks are 23-50px long (double doors ~46-50px) and 3-5px thick.
        if not (20 <= long_ <= 52 and 3 <= short <= 6 and long_ >= 4 * short):
            continue
        horizontal = w > h
        cx, cy = x + w / 2, y + h / 2
        # Sample both sides of the bar at three points along it, a few px
        # beyond its thickness; a door separates two *different* regions.
        info = []
        for sign in (-1, 1):
            votes = []
            for t in (0.25, 0.5, 0.75):
                along = (x + w * t, y + h * t)
                for off in (short / 2 + 3, short / 2 + 6):
                    sx, sy = (along[0], cy + sign * off) if horizontal else (cx + sign * off, along[1])
                    ix, iy = int(round(sx)), int(round(sy))
                    if 0 <= ix < W and 0 <= iy < H:
                        votes.append((int(cls[iy, ix]), int(room_id[iy, ix])))
            if not votes:
                info.append({"class": "outside", "room": None})
                continue
            (c, r), n = max(((v, votes.count(v)) for v in set(votes)), key=lambda p: p[1])
            name = CLASSES[c] if c < len(CLASSES) else ["ink", "mixed", "uncovered"][c - len(CLASSES)]
            info.append({"class": name, "room": r or None, "agreement": n / len(votes)})
        a_, b_ = info
        regions = {(s["class"], s["room"]) for s in info}
        if len(regions) < 2 or "room" not in (a_["class"], b_["class"]) or {"ink", "mixed"} & {a_["class"], b_["class"]}:
            continue
        if min(s.get("agreement", 0) for s in info) < 0.8:
            continue
        feats["doors"].append({"bbox": [x, y, w, h], "orientation": "h" if horizontal else "v", "sides": info})

    # Text blocks: remaining ink (not outlines: those are 1px and long), grouped.
    glyph = ink & ~cv2.dilate(thick, np.ones((3, 3), np.uint8)).astype(bool)
    # Long thin lines are outlines; remove components whose bbox is a line.
    keep = np.zeros_like(glyph)
    for i, lab, (x, y, w, h), a in components(glyph, 4, 8):
        if (w > 40 and h <= 3) or (h > 40 and w <= 3) or a > 0.6 * w * h and (w > 60 or h > 60):
            continue
        keep[y:y + h, x:x + w] |= lab[y:y + h, x:x + w] == i
    blocks = cv2.dilate(keep.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (15, 9)))
    for i, lab, (x, y, w, h), a in components(blocks, 60, 8):
        inner = keep[y:y + h, x:x + w] & (lab[y:y + h, x:x + w] == i)
        ys, xs = np.where(inner)
        if len(xs) < 25:
            continue
        bx0, by0, bx1, by1 = x + xs.min(), y + ys.min(), x + xs.max() + 1, y + ys.max() + 1
        cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
        feats["texts"].append({"bbox": [int(bx0), int(by0), int(bx1 - bx0), int(by1 - by0)], "room": int(room_id[cy, cx]) or None})
    if with_maps:
        return feats, cls, room_id
    return feats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    feats = extract(args.image)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(feats) + "\n")
    print(json.dumps({k: len(v) if isinstance(v, list) else v for k, v in feats.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
