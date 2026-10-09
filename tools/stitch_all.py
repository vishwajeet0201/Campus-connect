#!/usr/bin/env python3
"""Run stitch_floor.py for each map-source folder and write a summary."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "map-source"


def main() -> int:
    folders = sorted(path for path in SOURCE.iterdir() if path.is_dir())
    rows = []
    for folder in folders:
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "stitch_floor.py"), str(folder)], capture_output=True, text=True)
        try:
            report = json.loads(result.stdout)
        except json.JSONDecodeError:
            report = {"folder": str(folder), "error": result.stderr.strip() or result.stdout.strip()}
        rows.append(report)
    (SOURCE / "stitch-summary.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    print("folder\ttiles\tconfidence\tproblems")
    for row in rows:
        problems = len(row.get("low_confidence_pairs", [])) + len(row.get("tiles_matching_nothing", [])) + len(row.get("visible_gaps", []))
        print(f"{Path(row['folder']).name}\t{row.get('tile_count', 0)}\t{row.get('confidence', 'n/a')}\t{problems}")
    return 0 if all("error" not in row for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
