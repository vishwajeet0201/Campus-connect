# 01 — Campus map

## Goal

An interactive, error-free campus map built from the screenshots in
`map-source/`: every floor stitched into one non-repeating image, and the VJTI
ground floor as a vector plan with search, room details and walking directions.

## Data

* **Stitched floors** — `public/maps/stitched/*.png`, produced and verified by
  `tools/mapstitch` (see `tools/README.md` for the method and the per-floor
  verification table). Each seam is *proven* from pixels, *constrained* with
  written evidence in `map-source/<floor>/stitch.json`, or the tile is
  *excluded* with a reason. Nothing unseen is drawn in.
* **Vector plan** — `lib/maps/data/vjti-G.json` (`FloorPlan` in
  `lib/maps/types.ts`), generated from the stitched image plus the transcribed
  names in `map-source/vjti-ground-floor/labels.json`. Coordinates are pixels of
  the stitched image. Rooms keep the source map's spelling; unlabelled blocks
  stay unnamed and aren't searchable.
* **Navigation graph** — part of the plan: nodes at doors, door approaches,
  reflex corners of walkable space, gates, open places and the foot of each
  staircase; edges are clear lines of sight (with their outdoor / open-area
  share). Rooms are entered only by drawn doors; passing through a room costs
  extra, so it only happens when the plan gives no other way in (e.g. the staff
  canteen opens only into the canteen).

## Behaviour

* Pan (drag), zoom (pinch, wheel, double-tap, +/− and 0 keys or buttons), fit
  floor. The plan always covers the screen area not hidden by overlays.
* Labels are drawn at least 10px tall and only where they fit their room.
* Tap a room, place or gate (or pick a search result) to select it and open its
  sheet; **Directions** routes to it from the Main Gate by default, with the
  start editable. Places sharing a name (two Boys / Girls Washrooms) are told
  apart as "… (near X)"; asking for one routes to the nearest.
* Steps: the first leg is described in map directions, later ones as turns
  relative to the walker; walking outside between buildings is called out.
* The voice guide uses the same places and routes.
* Filter chips emphasise matching rooms and dim the rest.
* Other floors show their stitched image in the same viewer. Seeded database
  POIs are shown only on floors without a real plan or image.

## Known limitations

* VJTI ground floor: no screenshot shows the west end of the VJTI Hostels /
  Football Ground blocks together with anything further east, so everything
  east of x≈3616 (the blocks' east ends, the Cricket Ground, Gate 5) is placed
  from where the Football Ground's label sits on its block: ±10px
  horizontally. The two zoomed-out east screenshots add ±0.12% zoom
  uncertainty (about ±2.5px at Gate 5). One zoomed-out screenshot showing the
  blocks' west ends and their labels together would make that seam proven.
* VJTI ground floor: the south edge of the Textile Garden is in no screenshot;
  it's drawn to the last visible pixel and faded.
* Some floors run on past their screenshots: the Mech ground floor's east end
  (open area, DL 001), the Mech 1st floor's west end (Staff Room) and two
  room corners under the floating buttons on VJTI 1st floor. Areas no
  screenshot shows are hatched, so a room cut off there reads as unseen.
* Parts shown only by the two downscaled uploads (Mech 1's middle, the VJTI
  ground floor east of the football ground) are softer than the rest.
* Rooms with no drawn door (building blocks, the stage, fields) get inferred
  entrances on every side facing walkable space; the sheet says so.
* The source map has no scale, so routes give no distances or times. Walkable
  ground between buildings is assumed to be open campus ground.
* Directions don't span floors yet; staircase nodes are in the graph for that.
