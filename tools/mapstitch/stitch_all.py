"""Stitch every map-source floor folder; print one summary line per floor.

Usage: python tools/mapstitch/stitch_all.py [--out public/maps/stitched]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# map-source folder -> published asset name (<building>-<floor code>)
FLOORS = {
    "vjti-ground-floor": "vjti-G",
    "vjti-floor-1": "vjti-1",
    "vjti-floor-2": "vjti-2",
    "vjti-floor-3": "vjti-3",
    "mech-ground-floor": "mech-G",
    "mech-floor-1": "mech-1",
    "mech-floor-2": "mech-2",
    "mech-floor-3": "mech-3",
    "mech-tpo": "mech-TPO",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "maps" / "stitched")
    ap.add_argument("--reports", type=Path, default=ROOT / "tools" / "mapstitch" / "reports")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    failed = 0
    for folder, name in FLOORS.items():
        if args.only and folder not in args.only and name not in args.only:
            continue
        proc = subprocess.run([sys.executable, str(ROOT / "tools" / "mapstitch" / "stitch.py"), str(ROOT / "map-source" / folder), "--out", str(args.out), "--reports", str(args.reports), "--name", name], capture_output=True, text=True)
        if proc.returncode != 0:
            failed += 1
            print(f"{name}\tFAILED\t{(proc.stderr or proc.stdout).strip().splitlines()[-1]}")
            continue
        summary = json.loads(proc.stdout.strip().splitlines()[-1])
        seams = ", ".join(f"{a}->{b}:{s}" for a, b, s in summary["seams"]) or "single tile"
        excluded = f"\tEXCLUDED {', '.join(summary['excluded'])}" if summary["excluded"] else ""
        print(f"{name}\t{summary['size'][0]}x{summary['size'][1]}\t{seams}\tworst tile mismatch {summary['worst_tile_mismatch']:.4f}{excluded}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
