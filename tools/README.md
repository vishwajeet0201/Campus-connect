# Map-source stitching

Install Python 3.11+ and the dependencies:

```powershell
python -m pip install opencv-python numpy pytesseract
```

Optional OCR also needs the Tesseract executable on `PATH`.

Stitch one map:

```powershell
python tools/stitch_floor.py map-source/vjti-ground-floor
```

The tool discovers image files by extension, so screenshot filenames are not
used for layout. It detects stable pixels from the repeated phone chrome, writes
`crop-detection.png`, and uses that usable region for edge-based feature and
phase-correlation matching. If detection is uncertain, it writes
`crop.json.suggested` and stops; review the debug image, rename the file to
`crop.json`, and rerun. A manual override has this shape:

```json
{"x": 34, "y": 280, "w": 1012, "h": 1690}
```

Successful runs produce `stitched.png`, `layout.json`, and `debug.png`.
`layout.json` records every tile offset, pair score, low-confidence pair, and
tile that matched nothing. Matching is constrained by `settings.json` (or
`crop.default.json` for the default crop), keeps five hypotheses per seam,
uses OCR/colour/stair voting when Tesseract is installed, and reports
ambiguous candidates instead of silently accepting them. `hints.json` can
provide content-labelled approximate offsets.

For a corrected manual layout, open `tools/align_tiles.html` in a browser,
load the cropped tiles and `layout.json`, then export the adjusted layout.
Running `stitch_floor.py` again with that `layout.json` skips matching and
renders the manual positions.

Run all source folders and print a tab-separated summary:

```powershell
python tools/stitch_all.py
```
