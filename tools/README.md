# Campus map pipeline (`tools/mapstitch`)

Turns the phone screenshots in `map-source/<floor>/` into one verified,
non-repeating image per floor, and (for floors with a `labels.json`) into the
interactive vector plan and navigation graph the app uses.

```bash
python -m pip install opencv-python-headless numpy scipy
npm run maps:stitch   # every floor -> public/maps/stitched/*.png + tools/mapstitch/reports/*.layout.json
npm run maps:build    # VJTI ground floor -> lib/maps/data/vjti-G.json
```

## 1. Stitching (`stitch.py`, `stitch_all.py`)

Tiles are taken in serial order (numeric file names, otherwise the screenshot
timestamp). Phone chrome is masked: status/navigation bars, the rounded frame,
the floor-title pill and its shadow. The two floating buttons are masked too, but
their soft drop shadow is *divided back out* using the measured transmission map
`fab-shadow.png`, so map content under the shadow is recovered instead of lost.

Each tile is registered to its predecessor by an exhaustive search over every
translation, then a zoom sweep (screenshots are sometimes pinch-zoomed; e.g.
`mech-floor-2` tile 2 is at 0.745x). A tile that doesn't overlap its predecessor
(a later screenshot that bridges two earlier ones) is registered to whichever
placed tile it does overlap. A zoomed-out tile is verified in its own, coarser
frame, so sharp outlines are never judged against upsampled blur. A zoom found
by the sweep is then refined below the pixel: the remaining offset of every
overlap block with detail in both directions is measured and one zoom + shift is
fitted to them (kept only if it verifies at least as well; the report gives the
fit's blocks, residual and zoom uncertainty). A native screenshot whose chained
zoom comes out within 0.25% of 1 (one reached through a zoomed bridging tile) is
placed at zoom 1, pixel for pixel, if all its seams still prove. A seam is
**proven** only when, over the whole overlap, ≥90% of edges coincide and <3% of
pixels differ (the residue is anti-aliasing of 1px outlines at sub-pixel
offsets); if a clearly different offset fits about as well, the seam is
ambiguous. Anything weaker or ambiguous stops the run. Each tile is then
compared against the final composite.

Screenshots that arrive downscaled (e.g. 923x2000 after a chat upload) are
resampled to the phone's 1080x2340; the report lists them under
`resampled_tiles`. Where tiles overlap, native screenshots win, then zoomed-out
ones, and resampled uploads only fill what nothing else shows. The image is
cropped to the drawn content (specks under 25px of compression noise don't
count) plus a 24px margin.

Seams that pixels cannot prove go in the floor's `stitch.json`:

* `pinned` — an offset with written evidence; reported as **constrained**.
  Axes the pixels *can* fix are listed under `refine` and solved by residual.
* `exclude` — a tile left out, with the reason; the floor is reported as partial.

Pixels no screenshot shows are left transparent, never guessed.

| Floor | Tiles | Seams | Notes |
| --- | --- | --- | --- |
| VJTI G | 8 | 6 proven, 1 constrained | Tile 6 shows only the uniform Hostels / Football Ground bands: its vertical offset is proven, its horizontal offset is estimated from where the two labels sit on their blocks, 837 ± 30px (see `stitch.json`). The last two screenshots (resampled, zoomed out 2.009x) add the blocks' east ends, the Cricket Ground and Gate 5. |
| VJTI 1 | 4 | 3 proven | tile 4 is zoomed 1.00375x |
| VJTI 2 | 2 | 1 proven | |
| VJTI 3 | 1 | — | |
| Mech G | 3 | 2 proven | |
| Mech 1 | 3 | 2 proven | The third screenshot (resampled, zoomed out 1.127x) bridges the first two. |
| Mech 2 | 3 | 2 proven | zoom changes of 0.745x and 1.432x |
| Mech 3, TPO | 1 each | — | |

## 2. Vector plan and navigation (`vectorize.py`, `build_floor.py`)

The source app draws every floor in a small flat palette, so features are read
exactly from colour: rooms, corridors, open areas, fields, gardens, gates,
stairs and door ticks (short thick bars across a room outline, accepted only
where they separate two different regions). Room names come from the floor's
`map-source/<floor>/labels.json`: transcribed verbatim from the screenshots and
anchored to a point inside each feature; blocks without a label stay unnamed.

Routing uses a reduced visibility graph over walkable space (corridors, open
areas and the ground between buildings, 9px clear of walls). Rooms are entered
only through drawn doors; stairs are obstacles. `tests/floor-plan.test.ts`
checks, among other things, that no route ever crosses a room it didn't enter
by a door.
