import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VJTI_GROUND, imageFor } from "@/lib/maps";
import { destinations, distanceToRoom, planRoute } from "@/lib/maps/routing";
import type { PlanPlace, PlanRoom, Point } from "@/lib/maps/types";

const plan = VJTI_GROUND;
const places = destinations(plan);
const byId = (id: string) => places.find((p) => p.id === id)!;

function insideRoom(room: PlanRoom, p: Point, inset: number) {
  const [x, y, w, h] = room.bbox;
  if (p.x <= x + inset || p.x >= x + w - inset || p.y <= y + inset || p.y >= y + h - inset) return false;
  if (room.shape.type === "rect") return true;
  // Even-odd point-in-polygon for L-shaped rooms.
  let inside = false;
  const pts = room.shape.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideRing(ring: [number, number][], p: Point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a field or garden, at least `inset` px from its outline. */
function insideArea(place: PlanPlace, p: Point, inset: number) {
  const [x, y, w, h] = place.bbox!;
  if (p.x <= x + inset || p.x >= x + w - inset || p.y <= y + inset || p.y >= y + h - inset) return false;
  const ring = place.rings![0];
  if (!insideRing(ring, p)) return false;
  return [-inset, inset].every((dx) => [-inset, inset].every((dy) => insideRing(ring, { x: p.x + dx, y: p.y + dy })));
}

const areas = plan.places.filter((p) => p.area);

/** Every room, field or garden a walking segment passes through (sampled every 2px, 3px inside the outline). */
function roomsCrossed(a: Point, b: Point) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  const hit = new Set<string>();
  for (let i = 0; i <= n; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    for (const room of plan.rooms) if (insideRoom(room, p, 3)) hit.add(room.id);
    for (const place of areas) if (insideArea(place, p, 3)) hit.add(place.id);
  }
  return hit;
}

describe("VJTI ground floor plan data", () => {
  it("was generated without problems", () => {
    expect(plan.problems).toEqual([]);
  });

  it("names every labelled room exactly once and keeps ids unique", () => {
    const ids = plan.rooms.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const named = plan.rooms.filter((r) => r.name);
    expect(named).toHaveLength(51);
    for (const room of named) {
      expect(room.node, room.id).toBeTypeOf("number");
      expect(room.lines?.length, room.id).toBeGreaterThan(0);
    }
    // Spellings are the source map's own.
    expect(named.map((r) => r.name)).toEqual(expect.arrayContaining(["VJTI SIMENS AICTE High Voltage Lab", "Director's Bunglow", "Dr. Suranjana Gangopadhyay", "Dr. Sudhir K. Bhil & Prof. Rahul Ingale"]));
  });

  it("has four gates and the open places", () => {
    expect(plan.gates.map((g) => g.id).sort()).toEqual(["gate-3", "gate-5", "main-gate", "mechanical-gate"]);
    expect(plan.places.map((p) => p.id).sort()).toEqual(["cricket-ground", "football-ground", "study-space", "textile-garden", "vjti-quad"]);
  });

  it("starts every gate's walk on the ground just inside its marker", () => {
    const { width, height } = plan.floor;
    for (const g of plan.gates) {
      const [x, y, w, h] = g.bbox;
      const [nx, ny] = plan.nav.nodes[g.node];
      // Gates sit on the campus boundary along their long side; inside is the
      // long side facing away from the nearer edge of the map.
      const beyond = w >= h
        ? (y < height - (y + h) ? ny - (y + h) : y - ny)
        : (x < width - (x + w) ? nx - (x + w) : x - nx);
      expect(beyond, g.id).toBeGreaterThan(0);
      // Clearance from the marker plus its outline (thicker where the source tile was upsampled).
      expect(beyond, g.id).toBeLessThanOrEqual(plan.nav.clearance + 6);
    }
    // The tall Gate 5 marker carries its label rotated, as in the source.
    expect(plan.gates.find((g) => g.id === "gate-5")!.label.rotate).toBe(90);
  });

  it("gives a stepped building an entrance on every long face", () => {
    const hostels = plan.rooms.find((r) => r.id === "vjti-hostels")!;
    const bottoms = (hostels.inferredEntrances ?? []).filter((e) => e.side === "bottom");
    // One onto the path below the west block, one below the taller east block.
    expect(bottoms.some((e) => e.x < 4570 && e.y > 800), JSON.stringify(bottoms)).toBe(true);
    expect(bottoms.some((e) => e.x > 4600 && e.y < 700), JSON.stringify(bottoms)).toBe(true);
  });

  it("draws fields and gardens as their real outlines", () => {
    for (const place of areas) {
      expect(place.rings?.[0]?.length, place.id).toBeGreaterThanOrEqual(4);
    }
    // The Cricket Ground's east side slants: its outline covers well under its box.
    const cricket = areas.find((p) => p.id === "cricket-ground")!;
    const ring = cricket.rings![0];
    const area = Math.abs(ring.reduce((sum, [x, y], i) => {
      const [x2, y2] = ring[(i + 1) % ring.length];
      return sum + x * y2 - x2 * y;
    }, 0)) / 2;
    expect(area / (cricket.bbox![2] * cricket.bbox![3])).toBeLessThan(0.95);
    // A straight slanted side, not a traced staircase of anti-aliased pixels.
    expect(ring.length).toBeLessThanOrEqual(15);
  });

  it("matches the size of the stitched image it was drawn from", () => {
    const report = JSON.parse(readFileSync("tools/mapstitch/reports/vjti-G.layout.json", "utf8"));
    expect([plan.floor.width, plan.floor.height]).toEqual(report.size);
  });

  it("only links doors to rooms that exist", () => {
    const ids = new Set(plan.rooms.map((r) => r.id));
    for (const door of plan.doors) for (const room of door.rooms) expect(ids.has(room), room).toBe(true);
  });

  it("keeps every graph edge between real nodes with a positive length", () => {
    const n = plan.nav.nodes.length;
    for (const [a, b, w, outside, open] of plan.nav.edges) {
      expect(a).toBeLessThan(n);
      expect(b).toBeLessThan(n);
      expect(w).toBeGreaterThan(0);
      expect(outside).toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThanOrEqual(1);
    }
  });
});

describe("routes on the VJTI ground floor", () => {
  // Every place from every gate, plus a spread of room-to-room journeys.
  const gates = places.filter((p) => p.kind === "gate");
  const rooms = places.filter((p) => p.kind === "room");
  const journeys: [string, string][] = [
    ...gates.flatMap((g) => places.filter((p) => p.id !== g.id).map((p) => [g.id, p.id] as [string, string])),
    ...rooms.flatMap((r, i) => rooms.filter((_, j) => (i * 7 + j * 3) % 11 === 0 && j !== i).map((o) => [r.id, o.id] as [string, string])),
  ];

  it("never walks through a room or field it hasn't entered by a door", () => {
    for (const [from, to] of journeys) {
      const route = planRoute(plan, byId(from), byId(to))!;
      expect(route, `${from} -> ${to}`).not.toBeNull();
      const kinds = route.nodes.map((n) => plan.nav.nodes[n][2]);
      const inside = (k: string) => k === "room" || k === "place";
      // The start and end features count as entered: a walk to a door-less one ends on its outline.
      const entered = new Set([from, to, ...route.nodes.filter((_, i) => inside(kinds[i])).map((n) => plan.nav.nodes[n][3])]);
      for (let i = 0; i < route.points.length - 1; i += 1) {
        // Hops between a room's (or field's) centre and its doorway are inside it by design.
        if (inside(kinds[i]) || inside(kinds[i + 1])) continue;
        for (const room of roomsCrossed(route.points[i], route.points[i + 1])) {
          expect(entered.has(room), `${from} -> ${to} crosses ${room}`).toBe(true);
        }
      }
    }
  });

  it("never passes through a field, a garden or a block with no drawn door", () => {
    const sealed = new Set([...plan.rooms.filter((r) => r.inferredEntrances?.length).map((r) => r.id), ...areas.map((p) => p.id)]);
    const extra: [string, string][] = [["gate-5", "canteen"], ["mechanical-gate", "gate-5"], ["main-gate", "gate-5"], ["main-gate", "cricket-ground"], ["gate-3", "vjti-hostels"]];
    for (const [from, to] of [...journeys, ...extra]) {
      const route = planRoute(plan, byId(from), byId(to))!;
      expect(route, `${from} -> ${to}`).not.toBeNull();
      const middle = route.nodes.slice(1, -1).map((n) => plan.nav.nodes[n]);
      for (const [, , kind, ref] of middle) {
        expect(kind === "room" || kind === "place" ? sealed.has(ref ?? "") : false, `${from} -> ${to} passes through ${ref}`).toBe(false);
      }
    }
  });

  it("describes every part of the walk in some step", () => {
    const fromFields = areas.flatMap((a) => places.filter((p) => p.id !== a.id).slice(0, 25).map((p) => [a.id, p.id] as [string, string]));
    for (const [from, to] of [...journeys, ...fromFields]) {
      const route = planRoute(plan, byId(from), byId(to))!;
      for (let i = 0; i < route.points.length - 1; i += 1) {
        expect(route.steps.some((st) => st.start <= i && st.end >= i + 1), `${from} -> ${to}: segment ${i} is in no step`).toBe(true);
      }
    }
  });

  it("starts and ends a walk to a door-less feature at the entrance it uses", () => {
    const hostels = plan.rooms.find((r) => r.id === "vjti-hostels")!;
    const route = planRoute(plan, byId("gate-5"), byId("vjti-hostels"))!;
    const end = route.points.at(-1)!;
    expect(hostels.inferredEntrances!.some((e) => Math.hypot(e.x - end.x, e.y - end.y) < 2), JSON.stringify(end)).toBe(true);
    expect(route.steps.at(-1)!.text).toMatch(/side of VJTI Hostels/);
    const back = planRoute(plan, byId("football-ground"), byId("main-gate"))!;
    expect(back.steps[0].text).toMatch(/^Start at the \w+ side of Football Ground\./);
  });

  it("routes from one washroom to its namesake rather than to itself", () => {
    const route = planRoute(plan, byId("boys-washroom"), byId("boys-washroom-east"))!;
    expect(route.points.length).toBeGreaterThan(1);
    expect(route.steps.at(-1)!.text).not.toMatch(/already at/);
  });

  it("takes the road between the hostels and the Cricket Ground to Gate 5", () => {
    for (const from of ["main-gate", "mechanical-gate"]) {
      const route = planRoute(plan, byId(from), byId("gate-5"))!;
      expect(route.points.some((p) => p.x > 5000 && p.y > 680 && p.y < 765), `${from}: ${JSON.stringify(route.points)}`).toBe(true);
    }
  });

  it("never steps on a staircase", () => {
    for (const [from, to] of journeys.slice(0, 120)) {
      const route = planRoute(plan, byId(from), byId(to))!;
      expect(route.nodes.some((n) => plan.nav.nodes[n][2] === "stairs"), `${from} -> ${to}`).toBe(false);
    }
  });

  it("produces steps that cover the whole walk in order", () => {
    for (const [from, to] of journeys.slice(0, 200)) {
      const route = planRoute(plan, byId(from), byId(to))!;
      const last = route.points.length - 1;
      expect(route.steps[0].start).toBe(0);
      expect(route.steps.at(-1)!.end).toBe(last);
      for (const step of route.steps) {
        expect(step.start).toBeGreaterThanOrEqual(0);
        expect(step.end).toBeLessThanOrEqual(last);
        expect(step.start).toBeLessThanOrEqual(step.end);
      }
      expect(route.steps.at(-1)!.text).toMatch(/You have arrived|You are already/);
    }
  });
});

describe("distance to a room", () => {
  // A stepped block: wide and low on the left, tall on the right.
  const stepped: PlanRoom = {
    id: "stepped", fid: 0, bbox: [0, 0, 200, 100],
    shape: { type: "poly", points: [[0, 50], [100, 50], [100, 0], [200, 0], [200, 100], [0, 100]] },
  } as PlanRoom;

  it("is zero inside and measured to the outline, not the box, in a notch", () => {
    expect(distanceToRoom(stepped, { x: 150, y: 50 })).toBe(0);
    expect(distanceToRoom(stepped, { x: 50, y: 70 })).toBe(0);
    // In the empty notch above the low block: 30px from its roof, though inside the box.
    expect(distanceToRoom(stepped, { x: 50, y: 20 })).toBeCloseTo(30);
    expect(distanceToRoom(stepped, { x: 260, y: 50 })).toBeCloseTo(60);
  });
});

describe("stitched floor images", () => {
  const floors: [string, string, string][] = [
    ["VJTI", "1", "vjti-1"], ["VJTI", "2", "vjti-2"], ["VJTI", "3", "vjti-3"],
    ["MECH", "G", "mech-G"], ["MECH", "1", "mech-1"], ["MECH", "2", "mech-2"], ["MECH", "3", "mech-3"], ["MECH", "TPO", "mech-TPO"],
  ];

  it("are registered at the size their verification report gives", () => {
    for (const [building, floor, name] of floors) {
      const report = JSON.parse(readFileSync(`tools/mapstitch/reports/${name}.layout.json`, "utf8"));
      const image = imageFor(building, floor);
      expect(image?.src, name).toBe(`/maps/stitched/${name}.png`);
      expect([image?.width, image?.height], name).toEqual(report.size);
      // A floor is only complete when no tile had to be left out.
      expect(Boolean(image?.partial), name).toBe(Boolean(report.excluded_tiles));
    }
  });
});
