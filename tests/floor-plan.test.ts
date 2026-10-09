import { describe, expect, it } from "vitest";
import { VJTI_GROUND } from "@/lib/maps";
import { destinations, planRoute } from "@/lib/maps/routing";
import type { PlanRoom, Point } from "@/lib/maps/types";

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

/** Every room a walking segment passes through (sampled every 2px, 3px inside the outline). */
function roomsCrossed(a: Point, b: Point) {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  const hit = new Set<string>();
  for (let i = 0; i <= n; i += 1) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    for (const room of plan.rooms) if (insideRoom(room, p, 3)) hit.add(room.id);
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

  it("has three gates and the open places", () => {
    expect(plan.gates.map((g) => g.id).sort()).toEqual(["gate-3", "main-gate", "mechanical-gate"]);
    expect(plan.places.map((p) => p.id).sort()).toEqual(["football-ground", "study-space", "textile-garden", "vjti-quad"]);
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

  it("never walks through a room it hasn't entered by a door", () => {
    for (const [from, to] of journeys) {
      const route = planRoute(plan, byId(from), byId(to))!;
      expect(route, `${from} -> ${to}`).not.toBeNull();
      const kinds = route.nodes.map((n) => plan.nav.nodes[n][2]);
      const entered = new Set(route.nodes.filter((_, i) => kinds[i] === "room").map((n) => plan.nav.nodes[n][3]));
      for (let i = 0; i < route.points.length - 1; i += 1) {
        // Hops between a room's centre and its doorway are inside that room by design.
        if (kinds[i] === "room" || kinds[i + 1] === "room") continue;
        for (const room of roomsCrossed(route.points[i], route.points[i + 1])) {
          expect(entered.has(room), `${from} -> ${to} crosses ${room}`).toBe(true);
        }
      }
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
