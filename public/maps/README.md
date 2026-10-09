# Campus map asset conventions

The map viewer supports SVG floor plans for the upper floors and a six-tile horizontal image map for the VJTI main-building ground floor.

## File layout

- `vjti-ground-floor-1.jpg` through `vjti-ground-floor-6.jpg`
- `floor-1.svg`
- `floor-2.svg`

The VJTI ground-floor images are cleaned of phone chrome and rendered in numeric order from left to right on a `6072 × 1510` canvas. Keep each tile at `1012 × 1510` so the seams remain stable. Runtime POI markers are intentionally not shown on this floor.

Each SVG should use a consistent viewBox such as `0 0 1600 1000` and define a few layer groups for rooms, corridors, walls, and labels.

## Required conventions

- Use a single top-level `<svg>` with `viewBox="0 0 1600 1000"` and `preserveAspectRatio="xMidYMid meet"`.
- Add a root group for the architectural shell, such as `<g id="walls">`, `<g id="corridors">`, `<g id="rooms">`, and optionally `<g id="labels">`.
- Use separate `<rect>`, `<path>`, or `<line>` elements per zone so the viewer can style and interact consistently.
- Give each significant room or zone a stable `id` such as `room-g101`, `room-1-201`, `room-lab-a`.
- Keep every POI coordinate in the same coordinate space as the SVG viewBox. In other words, a room at `x=420`, `y=260` is a point within the same `0 0 1600 1000` plane as the SVG.
- If you add wayfinding labels or outlines, keep them in non-interactive groups and leave the floor area itself easy to scale.

## POI coordinate mapping

When a POI record lists `x` and `y`, these values are interpreted in the SVG’s coordinate system, not in CSS pixels.

- `x` increases to the right.
- `y` increases downward.
- A point like `x=500, y=420` maps directly to the SVG canvas at those coordinates.
- The map viewer uses these positions to position POI markers and to center the camera when selecting a result.

## Compatibility notes

- Keep the SVG architecture and room IDs stable so future updates can preserve linkages and searches.
- If you need to change room geometry, keep the viewBox and coordinate system constant.
- Mark important door or lift points with explicit layer names so you can later add graph nodes for routing.

## Example marker mapping

A POI like "Room 101" on Floor 1 can be mapped to the room group `room-1-101` with a coordinate such as `x=430` and `y=520`.
The marker is visually placed at that coordinate on the floor plan, while the room geometry remains the actual visual ground truth.
