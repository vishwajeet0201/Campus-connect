import type { FloorPlan, PlaceCategory, Point } from "./types";

/** Anything a student can start from or walk to on a floor. */
export type Destination = {
  id: string;
  name: string;
  /** Name plus a disambiguating hint when several places share a name. */
  label: string;
  kind: "room" | "place" | "gate";
  category: PlaceCategory;
  node: number;
  point: Point;
  aliases: string[];
};

export type RouteStep = {
  text: string;
  /** Range of `points` this step covers (inclusive). */
  start: number;
  end: number;
};

export type PlanRoute = {
  from: Destination;
  to: Destination;
  nodes: number[];
  points: Point[];
  /** Per segment (points[i] -> points[i + 1]): walked outside between buildings. */
  outdoor: boolean[];
  steps: RouteStep[];
  cost: number;
};

const TURN = 35; // degrees below which a bend reads as "continue"
const SHARP = 135;

type Graph = { adj: [number, number][][]; edge: Map<number, [number, number]>; key: (a: number, b: number) => number };

const graphs = new WeakMap<FloorPlan, Graph>();

function graphOf(plan: FloorPlan): Graph {
  const cached = graphs.get(plan);
  if (cached) return cached;
  const n = plan.nav.nodes.length;
  const adj: [number, number][][] = Array.from({ length: n }, () => []);
  const key = (a: number, b: number) => Math.min(a, b) * n + Math.max(a, b);
  const edge = new Map<number, [number, number]>();
  for (const [a, b, w, outside, open] of plan.nav.edges) {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
    edge.set(key(a, b), [outside, open]);
  }
  const graph = { adj, edge, key };
  graphs.set(plan, graph);
  return graph;
}

const pointOf = (plan: FloorPlan, node: number): Point => ({ x: plan.nav.nodes[node][0], y: plan.nav.nodes[node][1] });

/** Dijkstra over the floor's navigation graph (binary heap). */
export function shortestPath(plan: FloorPlan, from: number, to: number): { nodes: number[]; cost: number } | null {
  const { adj } = graphOf(plan);
  const dist = new Float64Array(adj.length).fill(Infinity);
  const prev = new Int32Array(adj.length).fill(-1);
  const heap: [number, number][] = [[0, from]];
  dist[from] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        push([nd, v]);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const nodes = [to];
  while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
  return { nodes, cost: dist[to] };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** How a place is referred to mid-sentence ("the cabin of Dr. N. M. Singh"). */
export function spokenName(d: Pick<Destination, "name" | "category">) {
  return d.category === "faculty" ? `the cabin of ${d.name}` : d.name;
}

const destinationCache = new WeakMap<FloorPlan, Destination[]>();

/** Named rooms, open places and gates, in a stable order. Places that share a
 * name (e.g. two "Boys Washroom"s) get a hint naming the nearest labelled room. */
export function destinations(plan: FloorPlan): Destination[] {
  const cached = destinationCache.get(plan);
  if (cached) return cached;
  const list: Destination[] = [];
  for (const room of plan.rooms) {
    if (!room.name || room.node == null || !room.category) continue;
    list.push({ id: room.id, name: room.name, label: room.name, kind: "room", category: room.category, node: room.node, point: pointOf(plan, room.node), aliases: room.aliases ?? [] });
  }
  for (const place of plan.places) {
    list.push({ id: place.id, name: place.name, label: place.name, kind: "place", category: place.category, node: place.node, point: { x: place.x, y: place.y }, aliases: place.aliases });
  }
  for (const gate of plan.gates) {
    list.push({ id: gate.id, name: gate.name, label: gate.name, kind: "gate", category: "gate", node: gate.node, point: { x: gate.bbox[0] + gate.bbox[2] / 2, y: gate.bbox[1] + gate.bbox[3] / 2 }, aliases: gate.aliases });
  }
  // Hint = the named room whose outline is closest to this one's (what you'd
  // see standing there), larger rooms winning near-ties as better landmarks.
  const gap = (a: [number, number, number, number], b: [number, number, number, number]) => Math.hypot(
    Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])),
    Math.max(0, a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3])),
  );
  const boxOf = (id: string) => plan.rooms.find((r) => r.id === id)?.bbox;
  const byName = new Map<string, Destination[]>();
  for (const d of list) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const d of group) {
      const own = boxOf(d.id);
      if (!own) continue;
      const near = plan.rooms
        .filter((r) => r.name && r.name !== d.name && r.category !== "faculty")
        .map((r) => ({ r, score: gap(own, r.bbox) - Math.min(r.bbox[2] * r.bbox[3], 60_000) / 4_000 }))
        .sort((a, b) => a.score - b.score)[0]?.r;
      if (near) d.label = `${d.name} (near ${near.name})`;
    }
  }
  destinationCache.set(plan, list);
  return list;
}

function nodeRef(plan: FloorPlan, node: number) {
  return plan.nav.nodes[node][3];
}

function headingDeg(a: Point, b: Point) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Signed bend from heading h1 to h2 in degrees; positive = turning right (y grows downwards). */
function bend(h1: number, h2: number) {
  let d = h2 - h1;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function mapDirection(a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = dx > 0 ? "right" : "left";
  const vertical = dy > 0 ? "bottom" : "top";
  if (Math.abs(dx) > 2.2 * Math.abs(dy)) return `towards the ${horizontal} of the map`;
  if (Math.abs(dy) > 2.2 * Math.abs(dx)) return `towards the ${vertical} of the map`;
  return `towards the ${vertical} ${horizontal} of the map`;
}

/** Named room or place closest to a point (within `radius`), skipping `exclude`. */
function landmark(plan: FloorPlan, p: Point, exclude: Set<string>, radius = 140) {
  let best: { name: string; d: number } | null = null;
  for (const room of plan.rooms) {
    if (!room.name || exclude.has(room.id)) continue;
    const [x, y, w, h] = room.bbox;
    const dx = Math.max(x - p.x, 0, p.x - (x + w));
    const dy = Math.max(y - p.y, 0, p.y - (y + h));
    const d = Math.hypot(dx, dy);
    if (d <= radius && (!best || d < best.d)) best = { name: room.name, d };
  }
  return best?.name;
}

/** Plan the walk between two destinations. If `to` names an amenity that
 * exists more than once (e.g. "Boys Washroom"), the nearest one is chosen. */
export function planRoute(plan: FloorPlan, from: Destination, to: Destination): PlanRoute | null {
  const candidates = destinations(plan).filter((d) => d.name === to.name && d.kind === to.kind);
  let best: { to: Destination; path: { nodes: number[]; cost: number } } | null = null;
  for (const target of candidates.length ? candidates : [to]) {
    const path = shortestPath(plan, from.node, target.node);
    if (path && (!best || path.cost < best.path.cost)) best = { to: target, path };
  }
  if (!best) return null;
  return describe(plan, from, best.to, best.path.nodes, best.path.cost);
}

const MIN_LEG = 30; // px; shorter wiggles are folded into the neighbouring leg

type Leg = { start: number; end: number; heading: number; outdoor: boolean; open: boolean };

/** Split one walking run (between doors) into legs at bends sharper than TURN
 * and where the walk moves between indoors and outdoors. */
function legsOf(points: Point[], outdoor: boolean[], open: boolean[], from: number, to: number): Leg[] {
  const legs: Leg[] = [];
  let i = from;
  while (i < to) {
    let j = i + 1;
    const startHeading = headingDeg(points[i], points[j]);
    while (j < to) {
      const next = headingDeg(points[j], points[j + 1]);
      if (outdoor[j] !== outdoor[i]) break;
      if (dist(points[j], points[j + 1]) >= MIN_LEG && Math.abs(bend(startHeading, next)) > TURN) break;
      j += 1;
    }
    const leg = { start: i, end: j, heading: headingDeg(points[i], points[j]), outdoor: outdoor[i], open: open.slice(i, j).some(Boolean) };
    const prev = legs[legs.length - 1];
    // Merge only when the walk really carries straight on: small bend at the
    // joint itself *and* between the two legs overall (no drift build-up).
    const joint = prev && Math.abs(bend(headingDeg(points[prev.end - 1], points[prev.end]), headingDeg(points[leg.start], points[leg.start + 1])));
    const straightOn = prev && prev.outdoor === leg.outdoor && prev.open === leg.open && joint !== undefined && joint < TURN && Math.abs(bend(prev.heading, leg.heading)) < TURN;
    if (prev && (straightOn || (prev.outdoor === leg.outdoor && dist(points[leg.start], points[leg.end]) < MIN_LEG))) {
      prev.end = leg.end;
      prev.heading = headingDeg(points[prev.start], points[prev.end]);
    } else {
      legs.push(leg);
    }
    i = j;
  }
  return legs;
}

function turnPhrase(previous: number, next: number) {
  const turn = bend(previous, next);
  const side = turn > 0 ? "right" : "left";
  if (Math.abs(turn) < TURN) return "Continue straight";
  if (Math.abs(turn) > SHARP) return `Turn sharply ${side}`;
  if (Math.abs(turn) < 60) return `Bear ${side}`;
  return `Turn ${side}`;
}

type Segment = { type: "room" | "door"; at: number } | { type: "walk"; start: number; end: number };

/** Path -> alternating rooms, doors and walking runs (approach/corner/place/gate nodes). */
function segmentsOf(kinds: string[]): Segment[] {
  const out: Segment[] = [];
  kinds.forEach((kind, i) => {
    if (kind === "room" || kind === "door") {
      out.push({ type: kind, at: i });
      return;
    }
    const prev = out[out.length - 1];
    if (prev?.type === "walk") prev.end = i;
    else out.push({ type: "walk", start: i, end: i });
  });
  return out;
}

function describe(plan: FloorPlan, from: Destination, to: Destination, nodes: number[], cost: number): PlanRoute {
  const graph = graphOf(plan);
  const points = nodes.map((n) => pointOf(plan, n));
  const share = (i: number) => graph.edge.get(graph.key(nodes[i], nodes[i + 1])) ?? [0, 0];
  const outdoor = points.slice(0, -1).map((_, i) => share(i)[0] > 0.5);
  const open = points.slice(0, -1).map((_, i) => share(i)[1] > 0.5);
  const kinds = nodes.map((n) => plan.nav.nodes[n][2]);
  const last = points.length - 1;
  const exclude = new Set([from.id, to.id]);
  const roomAt = (i: number) => plan.rooms.find((r) => r.id === nodeRef(plan, nodes[i]));
  const roomName = (i: number) => {
    if (i === last) return spokenName(to);
    if (i === 0) return spokenName(from);
    const room = roomAt(i);
    return room?.name && room.category ? spokenName({ name: room.name, category: room.category }) : "the room";
  };
  // Rooms walked through are never used as landmarks for the walk after them.
  nodes.forEach((n, i) => { if (kinds[i] === "room") exclude.add(nodeRef(plan, n) ?? ""); });
  let lastMark: string | undefined;
  const segments = segmentsOf(kinds);
  const steps: RouteStep[] = [];
  let facing: number | null = null;
  // Where the walker stands when the next step begins.
  let cursor = 0;

  const sideOf = (door: number) => {
    if (facing === null) return "ahead";
    const towards = bend(facing, headingDeg(points[cursor], points[door]));
    return Math.abs(towards) < 30 ? "ahead" : towards > 0 ? "on your right" : "on your left";
  };
  const appendTo = (text: string, end: number) => {
    const previous = steps[steps.length - 1];
    previous.text = previous.text.replace(/\.$/, text);
    previous.end = Math.max(previous.end, end);
  };

  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s];
    if (seg.type === "walk") {
      if (steps.length === 0) steps.push({ text: `Start at ${from.label}.`, start: 0, end: 0 });
      const runStart = Math.max(seg.start, cursor);
      const nextDoor = segments[s + 1]?.type === "door";
      for (const leg of seg.end > runStart ? legsOf(points, outdoor, open, runStart, seg.end) : []) {
        const where = leg.outdoor ? "outside" : leg.open ? "across the open area" : "along the corridor";
        const found = leg.end === seg.end && nextDoor ? undefined : landmark(plan, points[leg.end], exclude);
        const mark = found !== lastMark ? found : undefined;
        lastMark = found;
        const verb = facing === null ? `Head ${mapDirection(points[leg.start], points[leg.end])}` : `${turnPhrase(facing, leg.heading)} and walk`;
        steps.push({ text: `${verb} ${where}${mark ? ` to ${mark}` : ""}.`, start: leg.start, end: leg.end });
        facing = leg.heading;
      }
      cursor = seg.end;
      continue;
    }
    if (seg.type === "room") {
      const nextDoor = segments[s + 1];
      if (seg.at === 0) {
        // Leaving the origin room.
        const out = nextDoor?.type === "door" ? Math.min(nextDoor.at + 1, last) : 0;
        const leaving = from.category === "faculty" ? `the cabin of ${from.label}` : from.label;
        steps.push({ text: `Leave ${leaving} through its door.`, start: 0, end: out });
        if (nextDoor?.type === "door") facing = headingDeg(points[nextDoor.at], points[out]);
        cursor = out;
        s += nextDoor?.type === "door" ? 1 : 0;
        continue;
      }
      if (seg.at === last) break; // arrival is described by the door before it
      // Passing through an intermediate room: in by one door, out by the next.
      const exit = nextDoor?.type === "door" ? nextDoor.at : seg.at;
      const after = Math.min(exit + 1, last);
      steps.push({ text: `Go through ${roomName(seg.at)} and out of its other door.`, start: seg.at, end: after });
      facing = exit + 1 <= last ? headingDeg(points[exit], points[after]) : facing;
      cursor = after;
      s += nextDoor?.type === "door" ? 1 : 0;
      continue;
    }
    // A door: say which side the room behind it is on, then go in.
    const room = segments[s + 1];
    if (room?.type !== "room") continue;
    const side = sideOf(seg.at);
    if (steps.length === 0) steps.push({ text: `Start at ${from.label}.`, start: 0, end: 0 });
    if (room.at === last) {
      const target = spokenName(to);
      appendTo(`; ${target.charAt(0).toUpperCase()}${target.slice(1)} is ${side}. You have arrived.`, last);
      cursor = last;
      break;
    }
    const passing = roomName(room.at);
    appendTo(`; ${passing.charAt(0).toUpperCase()}${passing.slice(1)} is ${side}.`, seg.at);
    cursor = seg.at;
  }
  const final = steps[steps.length - 1];
  if (!final.text.includes("You have arrived")) {
    final.text = steps.length === 1 ? `You are already at ${spokenName(to)}.` : `${final.text} You have arrived at ${spokenName(to)}.`;
  }
  final.end = last;
  return { from, to, nodes, points, outdoor, steps, cost };
}
