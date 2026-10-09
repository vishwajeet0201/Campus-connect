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

* VJTI ground floor: the east edge of the VJTI Hostels and Football Ground
  blocks and the south edge of the Textile Garden are in no screenshot; they're
  drawn to the last visible pixel and faded.
* Mech 1st floor: the east wing is missing until a screenshot bridging the two
  existing ones is added.
* Rooms with no drawn door (building blocks, the stage, fields) get inferred
  entrances on every side facing walkable space; the sheet says so.
* The source map has no scale, so routes give no distances or times. Walkable
  ground between buildings is assumed to be open campus ground.
* Directions don't span floors yet; staircase nodes are in the graph for that.
