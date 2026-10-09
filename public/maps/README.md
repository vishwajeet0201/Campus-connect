# Campus map assets

* `stitched/<building>-<floor>.png` — one verified image per floor, stitched from
  `map-source/` by `tools/mapstitch` (see `tools/README.md`). Transparent pixels
  are areas no screenshot shows. Verification reports live in
  `tools/mapstitch/reports/`.
* `floor-*.svg`, `vjti-*.svg`, `mech-*.svg` — earlier placeholder drawings still
  referenced by database rows. The app overrides them with the stitched images
  (`lib/maps/index.ts`), so they are no longer shown.

The VJTI ground floor is drawn as an interactive vector plan from
`lib/maps/data/vjti-G.json`, whose coordinates are pixels of
`stitched/vjti-G.png` (6225 × 1835). Keep them in step: regenerate both with
`npm run maps:stitch` and `npm run maps:build`.
