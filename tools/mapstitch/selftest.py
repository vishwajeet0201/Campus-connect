"""Self-test for the stitcher's geometry on a synthetic floor plan.

Usage: python tools/mapstitch/selftest.py   (exits non-zero on failure)

Warps a drawn plan by known zooms and shifts and checks that refine_zoom
recovers them; checks the crop and open-edge helpers on small cases.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mapstitch.stitch import content_bbox, find_open_edges, refine_zoom, zoom_offset  # noqa: E402

FILLS = [(255, 228, 191), (171, 219, 243), (208, 238, 255), (159, 255, 178)]  # BGR: room, corridor, open, field


def synthetic_plan(h: int = 2340, w: int = 1080) -> np.ndarray:
    rng = np.random.default_rng(3)
    img = np.full((h, w, 3), 255, np.uint8)
    for _ in range(70):
        x, y = int(rng.integers(0, w - 120)), int(rng.integers(0, h - 120))
        bw, bh = int(rng.integers(40, 260)), int(rng.integers(40, 260))
        fill = FILLS[int(rng.integers(0, len(FILLS)))]
        cv2.rectangle(img, (x, y), (x + bw, y + bh), fill, -1, cv2.LINE_AA)
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (60, 60, 60), 1, cv2.LINE_AA)
        cv2.putText(img, "Lab", (x + 6, y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1, cv2.LINE_AA)
    return img


def check_zoom_recovery() -> list[str]:
    plan = synthetic_plan()
    mask = np.full(plan.shape[:2], 255, np.uint8)
    mask[:130] = 0
    mask[2114:] = 0
    failures = []
    for s0, t0 in ((0.498, (-31.4, 560.2)), (0.887, (12.37, -40.61)), (1.0042, (-3.2, 5.7)), (1.4317, (-210.3, -380.8))):
        H, W = plan.shape[:2]
        M = np.float32([[s0, 0, t0[0]], [0, s0, t0[1]]])
        src = cv2.GaussianBlur(plan, (0, 0), 0.29 / s0) if s0 < 1 else plan
        a = cv2.warpAffine(src, M, (W, H), flags=cv2.INTER_LINEAR if s0 < 1 else cv2.INTER_CUBIC, borderValue=(255, 255, 255))
        ma = cv2.erode(cv2.warpAffine(mask, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0), np.ones((5, 5), np.uint8))
        # Start where an integer sweep would: zoom ~0.1% off, shift a pixel off.
        s1 = round(s0 * 1.001, 4)
        o = zoom_offset(s1)
        fit = refine_zoom(a, ma, plan, mask, s1, int(round(t0[0] - o + 1)), int(round(t0[1] - o - 1)))
        # Worst position error over the tile.
        corners = np.array([[0, 0], [W, 0], [0, H], [W, H]], float)
        err = np.abs(corners * fit["scale"] + [fit["dx"], fit["dy"]] - (corners * s0 + t0)).max()
        status = "ok" if err < 0.1 else "FAIL"
        print(f"zoom {s0}: fitted {fit['scale']:.6f}, worst position error {err:.3f}px {status}")
        if err >= 0.1:
            failures.append(f"zoom {s0}: error {err:.3f}px")
    return failures


def check_helpers() -> list[str]:
    failures = []
    canvas = np.full((200, 200, 3), 255, np.uint8)
    canvas[50:54, 60:64] = 0  # a lone speck: kept rather than cropping to nothing
    if content_bbox(canvas, np.zeros((200, 200), np.int16)) != (60, 50, 64, 54):
        failures.append("content_bbox drops a canvas of specks")
    covered = np.ones((200, 200), bool)
    covered[:, :20] = False
    img = np.full((200, 200, 3), 255, np.uint8)
    img[80:140, 20:120] = FILLS[0]  # a room running into the unseen strip
    img[160:170, 60:120] = FILLS[1]  # a block ending well clear of it
    edges = find_open_edges(img, covered)
    if [e["side"] for e in edges] != ["left"] or not 75 <= edges[0]["bbox"][1] <= 85:
        failures.append(f"find_open_edges: {edges}")
    return failures


def main() -> int:
    failures = check_zoom_recovery() + check_helpers()
    for f in failures:
        print("FAILED:", f)
    print("selftest", "failed" if failures else "passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
