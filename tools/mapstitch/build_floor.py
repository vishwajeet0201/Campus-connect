"""Assemble a floor's interactive vector map and navigation graph.

Inputs: the stitched floor image and the floor's labels.json (names
transcribed from the screenshots, each anchored to a point inside its
feature). Output: one JSON document consumed by the app (lib/maps).

Navigation model
----------------
* Walkable space = corridors, open areas, stairs and passages (indoor) plus
  the white ground between buildings (outdoor, costed x OUTDOOR_COST so routes
  prefer corridors). Rooms, fields, gardens and anything no screenshot shows
  are obstacles.
* Rooms are entered only through the doors drawn on the plan. A feature with
  no drawn door (a building block, the stage, a field) gets "inferred"
  entrances on every side that faces walkable space; the output flags them.
* Between those points the graph is a reduced visibility graph: nodes at the
  reflex corners of walkable space (kept CLEARANCE px off walls) joined by
  every line of sight that is tangent at its corners. Shortest paths over it
  are true shortest walking paths at that clearance.

Usage:
    python tools/mapstitch/build_floor.py public/maps/stitched/vjti-G.png map-source/vjti-ground-floor/labels.json --out lib/maps/data/vjti-G.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mapstitch.vectorize import CLASSES, INK, MIXED, extract, fill_holes, polygon  # noqa: E402

CLEARANCE = 9
OUTDOOR_COST = 1.3
ROOM_TRANSIT = 400
C = {name: i for i, name in enumerate(CLASSES)}


def disk(r: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def walk_masks(cls: np.ndarray, room_id: np.ndarray, stairs: list[dict]):
    indoor = np.isin(cls, [C["corridor"], C["open"], C["service"]])
    # Labels and small red glyphs (the quad's heart) are drawn *on* walkable
    # floor; close them back in without bridging into rooms or fields.
    closed = cv2.morphologyEx(indoor.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(bool)
    soft = np.isin(cls, [INK, MIXED, C["stairs"]])
    indoor |= closed & soft & (room_id == 0)
    # A drawn staircase climbs from where it stands; you can't walk across it.
    for st in stairs:
        x, y, w, h = st["bbox"]
        block = np.zeros_like(indoor)
        cv2.fillPoly(block.view(np.uint8), [np.array(r, np.int32) for r in st["rings"]], 1)
        block[y:y + h, x:x + w] |= cls[y:y + h, x:x + w] == C["stairs"]
        indoor &= ~cv2.dilate(block.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    outdoor = (cls == C["white"]) | (cls == C["gate"])
    free = indoor | outdoor
    free_c = cv2.erode(free.astype(np.uint8), disk(CLEARANCE)).astype(bool)
    los = cv2.erode(free.astype(np.uint8), disk(CLEARANCE - 3)).astype(bool)
    return indoor, outdoor, free_c, los


def snap(mask: np.ndarray, x: float, y: float, radius: int = 40):
    """Nearest True pixel of mask to (x, y) within radius, or None."""
    H, W = mask.shape
    x0, y0 = max(0, int(x) - radius), max(0, int(y) - radius)
    x1, y1 = min(W, int(x) + radius + 1), min(H, int(y) + radius + 1)
    ys, xs = np.nonzero(mask[y0:y1, x0:x1])
    if len(xs) == 0:
        return None
    d = (xs + x0 - x) ** 2 + (ys + y0 - y) ** 2
    k = int(np.argmin(d))
    if d[k] > radius * radius:
        return None
    return float(xs[k] + x0), float(ys[k] + y0)


def geodesic_snap(target: np.ndarray, passable: np.ndarray, seeds: np.ndarray, limit: int = 160):
    """Nearest target pixel reachable from `seeds` moving only through
    `passable` pixels (so never through a room's walls), or None."""
    from collections import deque
    ys, xs = np.nonzero(seeds)
    if len(xs) == 0:
        return None
    H, W = target.shape
    x0, y0 = max(0, xs.min() - limit), max(0, ys.min() - limit)
    x1, y1 = min(W, xs.max() + limit + 1), min(H, ys.max() + limit + 1)
    seen = np.zeros((y1 - y0, x1 - x0), bool)
    queue = deque()
    for x, y in zip(xs, ys):
        seen[y - y0, x - x0] = True
        queue.append((x, y, 0))
    while queue:
        x, y, d = queue.popleft()
        if target[y, x]:
            return float(x), float(y)
        if d >= limit:
            continue
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if x0 <= nx < x1 and y0 <= ny < y1 and not seen[ny - y0, nx - x0] and passable[ny, nx]:
                seen[ny - y0, nx - x0] = True
                queue.append((nx, ny, d + 1))
    return None


def reflex_corners(free_c: np.ndarray):
    """Corners of walkable space that a taut path can bend around."""
    contours, _ = cv2.findContours(free_c.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    k = disk(5).astype(bool)
    H, W = free_c.shape
    out = []
    for c in contours:
        poly = cv2.approxPolyDP(c, 2.0, True).reshape(-1, 2)
        n = len(poly)
        if n < 3:
            continue
        for i in range(n):
            x, y = (int(v) for v in poly[i])
            if not (5 <= x < W - 5 and 5 <= y < H - 5):
                continue
            frac = free_c[y - 5:y + 6, x - 5:x + 6][k].mean()
            if frac > 0.6:
                out.append(((float(x), float(y)), tuple(map(float, poly[i - 1])), tuple(map(float, poly[(i + 1) % n]))))
    return out


def line_of_sight(los: np.ndarray, outdoor: np.ndarray, open_: np.ndarray, a, b):
    """(length, outdoor share, open-area share) of a clear segment, else None."""
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(2, int(length / 2) + 1)
    xs = np.linspace(a[0], b[0], n).round().astype(int)
    ys = np.linspace(a[1], b[1], n).round().astype(int)
    if not los[ys, xs].all():
        return None
    return length, float(outdoor[ys, xs].mean()), float(open_[ys, xs].mean())


def tangent(corner, other) -> bool:
    """A segment leaving a corner is useful only if it doesn't cut into the
    obstacle there, i.e. both polygon neighbours lie on the same side of it."""
    (vx, vy), p, n = corner
    dx, dy = other[0] - vx, other[1] - vy
    s1 = dx * (p[1] - vy) - dy * (p[0] - vx)
    s2 = dx * (n[1] - vy) - dy * (n[0] - vx)
    return s1 * s2 >= -1e-6


def label_from_ink(cls: np.ndarray, room_mask: np.ndarray, n_lines: int):
    """Position and font size of a room's label, measured from the label's own
    ink: dark pixels well inside the room (clear of its outline, door ticks and
    any stairs drawn in it)."""
    inner = cv2.erode(room_mask.astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool)
    stairs = cv2.dilate((cls == C["stairs"]).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    ys, xs = np.nonzero(inner & np.isin(cls, [INK, MIXED]) & ~stairs)
    if len(xs) < 20:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # Block height spans n lines at a 1.22em pitch plus ~0.95em for the last line.
    size = (y1 - y0) / (1.22 * (n_lines - 1) + 0.95)
    return {"x": round(float(x0 + x1) / 2, 1), "y": round(float(y0 + y1) / 2, 1), "size": round(float(min(max(size, 7), 40)), 1)}


def gate_label(rgb: np.ndarray, box: list[int]) -> dict:
    """Centre, font size (from the height of the label's own white ink) and
    rotation of a gate's label. Gate markers taller than wide carry their
    label rotated to read top to bottom, as in the source map."""
    x, y, w, h = box
    vertical = h > w
    ink = rgb[y + 3:y + h - 3, x + 3:x + w - 3].min(axis=2) > 160
    across = np.flatnonzero(ink.any(axis=0 if vertical else 1))
    size = (across[-1] - across[0] + 1) / 0.95 if across.size else min(w, h) * 0.56
    return {"x": x + w / 2, "y": y + h / 2, "size": round(float(size), 1), **({"rotate": 90} if vertical else {})}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("labels", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--image-url", required=True, help="public URL of the stitched image")
    ap.add_argument("--debug", type=Path)
    args = ap.parse_args()

    feats, cls, room_id = extract(args.image, with_maps=True)
    rgb = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    labels = json.loads(args.labels.read_text())
    H, W = cls.shape
    indoor, outdoor, free_c, los = walk_masks(cls, room_id, feats["stairs"])
    problems: list[str] = []

    # --- rooms -----------------------------------------------------------
    named: dict[int, dict] = {}
    for entry in labels["rooms"]:
        x, y = entry["at"]
        fid = int(room_id[y, x])
        if not fid:
            raise SystemExit(f"label {entry['id']} at {entry['at']} is not inside any room")
        if fid in named:
            raise SystemExit(f"labels {named[fid]['id']} and {entry['id']} both point at room {fid}")
        named[fid] = entry
    rooms = []
    fid_to_index = {}
    for r in feats["rooms"]:
        x, y, w, h = r["bbox"]
        entry = named.get(r["id"])
        if r["rect"]:
            shape = {"type": "rect", "x": x - 1, "y": y - 1, "w": w + 2, "h": h + 2}
        else:
            ring = max(r["polygon"], key=lambda ring: abs(cv2.contourArea(np.array(ring, np.int32))))
            shape = {"type": "poly", "points": ring}
        room = {"id": entry["id"] if entry else f"unnamed-{r['id']}", "fid": r["id"], "shape": shape, "bbox": [x - 1, y - 1, w + 2, h + 2]}
        if entry:
            lines = entry["lines"]
            room.update({
                # An explicit name wins: line breaks can't tell a wrapped name
                # ("Dr. Suranjana / Gangopadhyay") from two people in one cabin.
                "name": entry.get("name") or " ".join(lines).replace("’", "'"),
                "lines": lines,
                "category": entry["category"],
                "aliases": entry.get("aliases", []),
                **({"unseenEdges": entry["unseenEdges"]} if entry.get("unseenEdges") else {}),
                "label": label_from_ink(cls, room_id == r["id"], len(lines)) or {"x": x + w / 2, "y": y + h / 2, "size": 14},
            })
        fid_to_index[r["id"]] = len(rooms)
        rooms.append(room)

    # --- areas -----------------------------------------------------------
    areas = []
    for a in feats["areas"]:
        kind = {"service": "passage"}.get(a["kind"], a["kind"])
        areas.append({"kind": kind, "bbox": a["bbox"], "rings": a["rings"]})

    # --- nav graph -------------------------------------------------------
    nodes: list[dict] = []
    edges: dict[tuple[int, int], float] = {}
    shares: dict[tuple[int, int], tuple[float, float]] = {}
    open_area = cls == C["open"]

    def add_node(x, y, kind, ref=None):
        nodes.append({"x": round(float(x), 1), "y": round(float(y), 1), "kind": kind, **({"ref": ref} if ref else {})})
        return len(nodes) - 1

    def link(a, b, w, outside=0.0, in_open=0.0):
        key = (min(a, b), max(a, b))
        if w < edges.get(key, math.inf):
            edges[key] = round(float(w), 1)
            shares[key] = (round(float(outside), 2), round(float(in_open), 2))

    corners = reflex_corners(free_c)
    corner_nodes = [(add_node(*c[0], "corner"), c) for c in corners]
    walk_nodes = [(i, c) for i, c in corner_nodes]

    room_nodes: dict[int, int] = {}
    for idx, room in enumerate(rooms):
        if "name" in room:
            room_nodes[idx] = add_node(room["label"]["x"], room["label"]["y"], "room", room["id"])

    doors_out = []
    for d in feats["doors"]:
        x, y, w, h = d["bbox"]
        cx, cy = x + w / 2, y + h / 2
        door = {"x": round(cx, 1), "y": round(cy, 1), "w": w, "h": h, "orientation": d["orientation"], "rooms": []}
        dn = add_node(cx, cy, "door")
        for sign, side in zip((-1, 1), d["sides"]):
            nx, ny = (0, sign) if d["orientation"] == "h" else (sign, 0)
            if side["class"] == "room":
                idx = fid_to_index[side["room"]]
                door["rooms"].append(rooms[idx]["id"])
                if idx in room_nodes:
                    rx, ry = nodes[room_nodes[idx]]["x"], nodes[room_nodes[idx]]["y"]
                    link(room_nodes[idx], dn, math.hypot(rx - cx, ry - cy) + ROOM_TRANSIT / 2)
                continue
            # Step out of the doorway into walkable space.
            off = min(w, h) / 2 + CLEARANCE + 3
            p = snap(free_c, cx + nx * off, cy + ny * off, 18)
            if p is None:
                problems.append(f"door at ({cx:.0f},{cy:.0f}) of {door['rooms']} has no walkable space beside it")
                continue
            an = add_node(*p, "approach")
            link(dn, an, math.hypot(p[0] - cx, p[1] - cy))
            walk_nodes.append((an, None))
        doors_out.append(door)

    # Rooms (and named areas) with no drawn door. The plan doesn't say which
    # side the entrance is on, so offer one on every side that faces walkable
    # space and let the shortest path choose; the output flags them as inferred.
    def inferred_entrance(mask: np.ndarray, anchor_node: int, label: str):
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        ax, ay = nodes[anchor_node]["x"], nodes[anchor_node]["y"]
        found = []
        # Sample each side on the shape's own boundary (its extreme pixel in
        # each row or column), so stepped and slanted outlines work too.
        cols = [int(round(x)) for x in np.linspace(x0, x1, 21)]
        rows = [int(round(y)) for y in np.linspace(y0, y1, 21)]
        col_ys = {x: np.flatnonzero(mask[:, x]) for x in cols}
        row_xs = {y: np.flatnonzero(mask[y]) for y in rows}
        sides = {
            "top": ([(x, col_ys[x][0]) for x in cols if col_ys[x].size], (0, -1)),
            "bottom": ([(x, col_ys[x][-1]) for x in cols if col_ys[x].size], (0, 1)),
            "left": ([(row_xs[y][0], y) for y in rows if row_xs[y].size], (-1, 0)),
            "right": ([(row_xs[y][-1], y) for y in rows if row_xs[y].size], (1, 0)),
        }
        for side, (points, (nx, ny)) in sides.items():
            # Prefer the middle of the side, then work outwards.
            order = sorted(range(len(points)), key=lambda i: abs(i - len(points) // 2))
            for i in order:
                px, py = points[i]
                hit = None
                for off in range(CLEARANCE + 2, 61, 2):
                    qx, qy = int(round(px + nx * off)), int(round(py + ny * off))
                    if not (0 <= qx < W and 0 <= qy < H):
                        break
                    if free_c[qy, qx]:
                        hit = (float(qx), float(qy))
                        break
                    if room_id[qy, qx] or not (indoor[qy, qx] or outdoor[qy, qx]):
                        break  # another room / obstacle in the way
                if hit:
                    dn = add_node(px, py, "door")
                    an = add_node(*hit, "approach")
                    link(anchor_node, dn, math.hypot(ax - px, ay - py) + ROOM_TRANSIT / 2)
                    link(dn, an, math.hypot(hit[0] - px, hit[1] - py))
                    walk_nodes.append((an, None))
                    found.append({"side": side, "x": round(float(px), 1), "y": round(float(py), 1)})
                    break
        if not found:
            problems.append(f"{label}: no walkable space near it")
        return found

    for idx, room in enumerate(rooms):
        if idx in room_nodes and not any(room["id"] in d["rooms"] for d in doors_out):
            mask = room_id == room["fid"]
            room["inferredEntrances"] = inferred_entrance(mask, room_nodes[idx], room["id"])

    places = []
    for p in labels.get("places", []):
        x, y = p["at"]
        place = {k: v for k, v in p.items() if k not in ("at",)}
        if p.get("area"):
            m = cls == C[p["area"]]
            n_, lab = cv2.connectedComponents(m.astype(np.uint8), connectivity=8)
            comp = lab == lab[y, x] if m[y, x] else None
            if comp is None:
                raise SystemExit(f"place {p['id']} anchor is not on its {p['area']}")
            ys, xs = np.nonzero(comp)
            place["bbox"] = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
            place["rings"] = polygon(fill_holes(np.pad(comp, 1))[1:-1, 1:-1])
            node = add_node(x, y, "place", p["id"])
            place["inferredEntrances"] = inferred_entrance(comp, node, p["id"])
        else:
            q = snap(free_c, x, y, 60)
            if q is None:
                raise SystemExit(f"place {p['id']} is not in walkable space")
            node = add_node(*q, "place", p["id"])
            walk_nodes.append((node, None))
        place.update({"x": x, "y": y, "node": node})
        places.append(place)

    gates = []
    for g in labels.get("gates", []):
        x, y = g["at"]
        box = next((b["bbox"] for b in feats["gates"] if b["bbox"][0] <= x < b["bbox"][0] + b["bbox"][2] and b["bbox"][1] <= y < b["bbox"][1] + b["bbox"][3]), None)
        if box is None:
            raise SystemExit(f"gate {g['id']} anchor is not on a gate marker")
        # Gates are drawn on the campus boundary, long side along it: the node
        # goes on walkable ground just inside, on the long side facing away
        # from the nearer edge of the map.
        bx, by, bw, bh = box
        inside = np.zeros_like(free_c)
        if bw >= bh:
            inward = "bottom" if by < H - (by + bh) else "top"
            mid = (bx + bw / 2, by + bh if inward == "bottom" else by)
            inside[by + bh:] = inward == "bottom"
            inside[:by] = inward == "top"
        else:
            inward = "right" if bx < W - (bx + bw) else "left"
            mid = (bx + bw if inward == "right" else bx, by + bh / 2)
            inside[:, bx + bw:] = inward == "right"
            inside[:, :bx] = inward == "left"
        q = snap(free_c & inside, *mid, 80)
        if q is None:
            raise SystemExit(f"gate {g['id']} has no walkable ground on its {inward} side")
        node = add_node(*q, "gate", g["id"])
        walk_nodes.append((node, None))
        gates.append({**{k: v for k, v in g.items() if k != "at"}, "bbox": box, "node": node, "label": gate_label(rgb, box)})

    stairs = []
    stair_nodes: list[int] = []
    for i, s in enumerate(feats["stairs"]):
        x, y, w, h = s["bbox"]
        footprint = np.zeros((H, W), np.uint8)
        cv2.fillPoly(footprint, [np.array(r, np.int32) for r in s["rings"]], 1)
        # Walk out from the staircase over floor only: stairs drawn inside a
        # room stay unlinked (they're reached through that room).
        floor = np.isin(cls, [C["corridor"], C["open"], C["service"], C["white"], C["gate"], C["stairs"]]) & (room_id == 0)
        # Seed just outside the staircase's own outline.
        seeds = cv2.dilate(footprint, np.ones((11, 11), np.uint8)).astype(bool) & floor
        q = geodesic_snap(free_c, floor, seeds)
        entry = {"id": f"stairs-{i + 1}", "bbox": s["bbox"], "rings": s["rings"]}
        if q:
            # Terminal node at the foot of the stairs (for links to other
            # floors). Joined to walkable space at a penalty so no route on
            # this floor ever passes through it.
            entry["node"] = add_node(*q, "stairs", entry["id"])
            stair_nodes.append(entry["node"])
        stairs.append(entry)

    # Visibility edges between every pair of walk nodes that see each other.
    pts = [(nodes[i]["x"], nodes[i]["y"]) for i, _ in walk_nodes]
    for a in range(len(walk_nodes)):
        ia, ca = walk_nodes[a]
        for b in range(a + 1, len(walk_nodes)):
            ib, cb = walk_nodes[b]
            if ca is not None and not tangent(ca, pts[b]):
                continue
            if cb is not None and not tangent(cb, pts[a]):
                continue
            hit = line_of_sight(los, outdoor, open_area, pts[a], pts[b])
            if hit:
                length, frac, open_frac = hit
                link(ia, ib, length * (1 + (OUTDOOR_COST - 1) * frac), frac, open_frac)

    for sn in stair_nodes:
        p = (nodes[sn]["x"], nodes[sn]["y"])
        seen_from = [(math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]), walk_nodes[k][0]) for k in range(len(walk_nodes)) if line_of_sight(los, outdoor, open_area, p, pts[k])]
        for d, other in sorted(seen_from)[:3]:
            link(sn, other, d + ROOM_TRANSIT / 2)

    # --- validation ------------------------------------------------------
    adj: dict[int, list[tuple[int, float]]] = {}
    for (a, b), w in edges.items():
        adj.setdefault(a, []).append((b, w))
        adj.setdefault(b, []).append((a, w))
    start = next(g["node"] for g in gates if g["id"] == "main-gate") if any(g["id"] == "main-gate" for g in gates) else gates[0]["node"]
    seen = {start}
    heap = [start]
    while heap:
        u = heap.pop()
        for v, _ in adj.get(u, []):
            if v not in seen:
                seen.add(v)
                heap.append(v)
    unreachable = [n["ref"] for i, n in enumerate(nodes) if n["kind"] in ("room", "place", "gate") and i not in seen]
    if unreachable:
        problems.append(f"unreachable from {nodes[start]['ref']}: {unreachable}")

    # Drop corner nodes no edge uses, and renumber.
    used = sorted({i for e in edges for i in e} | set(room_nodes.values()) | {p["node"] for p in places} | {g["node"] for g in gates})
    remap = {old: new for new, old in enumerate(used)}
    out_nodes = [[nodes[i]["x"], nodes[i]["y"], nodes[i]["kind"], nodes[i].get("ref")] for i in used]
    out_edges = sorted([remap[a], remap[b], w, *shares[(a, b)]] for (a, b), w in edges.items() if a in remap and b in remap)
    for room in rooms:
        idx = fid_to_index[room["fid"]]
        if idx in room_nodes:
            room["node"] = remap[room_nodes[idx]]
        room.pop("fid")
    for p in places:
        p["node"] = remap[p["node"]]
    for g in gates:
        g["node"] = remap[g["node"]]
    for s in stairs:
        if "node" in s:
            s["node"] = remap.get(s["node"])

    doc = {
        "floor": {**labels["floor"], "width": W, "height": H, "image": args.image_url},
        "rooms": rooms,
        "areas": areas,
        "doors": doors_out,
        "stairs": stairs,
        "gates": gates,
        "places": places,
        "nav": {"clearance": CLEARANCE, "outdoorCost": OUTDOOR_COST, "roomTransit": ROOM_TRANSIT, "nodes": out_nodes, "edges": out_edges},
        "problems": problems,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(json.dumps({"rooms": len(rooms), "named": sum("name" in r for r in rooms), "doors": len(doors_out), "nodes": len(out_nodes), "edges": len(out_edges), "inferred": {x["id"]: [e["side"] for e in x["inferredEntrances"]] for x in rooms + places if x.get("inferredEntrances")}, "problems": problems}, indent=1))
    if args.debug:
        dbg = cv2.imread(str(args.image))
        tint = dbg.copy()
        tint[free_c] = (0.6 * tint[free_c] + 0.4 * np.array([120, 255, 120])).astype(np.uint8)
        for a, b, *_ in out_edges:
            pa, pb = out_nodes[a], out_nodes[b]
            cv2.line(tint, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), (200, 120, 0), 1)
        for x, y, kind, _ in out_nodes:
            col = {"corner": (0, 0, 255), "door": (255, 0, 255), "approach": (255, 0, 0), "room": (0, 120, 0)}.get(kind, (0, 140, 255))
            cv2.circle(tint, (int(x), int(y)), 4, col, -1)
        args.debug.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.debug / f"{labels['floor']['id']}-graph.png"), tint)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
