import { GROUND_FLOOR_EDGES, GROUND_FLOOR_NODES, GROUND_FLOOR_ROOMS, type GroundFloorNode } from "@/lib/ground-floor";

export type NavPlace = { id: string; name: string; nodeId: string; aliases: string[] };
export type NavStep = { nodeId: string; text: string };
export type NavRoute = { from: NavPlace; to: NavPlace; nodeIds: string[]; steps: NavStep[] };
export type PlaceMatch = { place: NavPlace; score: number };

const EXTRA_ALIASES: Record<string, string[]> = {
  "mechanical-gate": ["mech gate", "main gate", "gate", "entrance"],
  "towards-mech": ["mech building", "mechanical building"],
  "directors-bungalow": ["director bungalow", "directors house"],
  canteen: ["cafeteria", "mess", "food court", "kitchen"],
  "canteen-staff": ["staff canteen"],
  auditorium: ["audi", "hall"],
  "vjti-quad": ["quad", "quadrangle", "courtyard"],
  "quad-stage": ["stage"],
  "boys-washroom": ["boys toilet", "gents toilet", "mens washroom", "men's toilet", "boys bathroom"],
  "girls-washroom": ["girls toilet", "ladies toilet", "womens washroom", "women's toilet", "girls bathroom"],
  "iot-lab": ["internet of things lab"],
  "coe-lab": ["centre of excellence", "center of excellence"],
  "simens-lab": ["siemens lab", "high voltage lab", "siemens"],
  "vjti-tbi": ["tbi", "incubator", "technology business incubator"],
  "cs-it-lab-2": ["computer lab 2", "it lab 2", "cs lab 2"],
  "cs-it-lab-3": ["computer lab 3", "it lab 3", "cs lab 3"],
  "study-space": ["study area", "reading area"],
  "vjti-hostels": ["hostel", "hostels"],
  "football-ground": ["ground", "football field", "playground", "sports ground"],
  "railway-concession": ["railway pass", "concession counter"],
  "electrical-dept-computer-lab": ["electrical computer lab"],
  "biomedical-research": ["biomedical lab"],
  gymkhana: ["gym"],
};

/** Every ground-floor room a student can name as a start or destination. */
export const NAV_PLACES: NavPlace[] = GROUND_FLOOR_ROOMS.map((room) => ({
  id: room.id,
  name: room.name,
  nodeId: `room-${room.id}`,
  aliases: [room.name, ...(EXTRA_ALIASES[room.id] ?? [])],
}));

const NODES = new Map(GROUND_FLOOR_NODES.map((node) => [node.id, node]));
const ROOM_NAMES = new Map(GROUND_FLOOR_ROOMS.map((room) => [`room-${room.id}`, room.name]));
const HUB_KINDS = new Set<GroundFloorNode["kind"]>(["corridor", "entrance"]);

const distance = (a: GroundFloorNode, b: GroundFloorNode) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Walkable adjacency for the ground floor. The drawn edges only cover some rooms,
 * so any room without an edge is linked to its nearest corridor or entrance.
 * Stairs are excluded: every route stays on the ground floor.
 */
function buildGraph() {
  const graph = new Map<string, Map<string, number>>();
  const link = (from: string, to: string) => {
    const a = NODES.get(from);
    const b = NODES.get(to);
    if (!a || !b) return;
    const weight = distance(a, b);
    if (!graph.has(from)) graph.set(from, new Map());
    if (!graph.has(to)) graph.set(to, new Map());
    graph.get(from)!.set(to, weight);
    graph.get(to)!.set(from, weight);
  };
  for (const edge of GROUND_FLOOR_EDGES) {
    if (edge.accessible) link(edge.from, edge.to);
  }
  const hubs = GROUND_FLOOR_NODES.filter((node) => HUB_KINDS.has(node.kind));
  for (const node of GROUND_FLOOR_NODES) {
    if (node.kind !== "room" || graph.has(node.id)) continue;
    const nearest = hubs.reduce((best, hub) => distance(node, hub) < distance(node, best) ? hub : best);
    link(node.id, nearest.id);
  }
  return graph;
}

const GRAPH = buildGraph();

/** Shortest path (Dijkstra) between two graph nodes, or null when unreachable. */
export function shortestPath(fromId: string, toId: string): string[] | null {
  if (!GRAPH.has(fromId) || !GRAPH.has(toId)) return null;
  const dist = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set(GRAPH.keys());
  while (pending.size) {
    let current: string | null = null;
    for (const id of pending) {
      if (dist.has(id) && (current === null || dist.get(id)! < dist.get(current)!)) current = id;
    }
    if (current === null) break;
    if (current === toId) break;
    pending.delete(current);
    for (const [next, weight] of GRAPH.get(current)!) {
      const candidate = dist.get(current)! + weight;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        previous.set(next, current);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const path = [toId];
  while (path[0] !== fromId) path.unshift(previous.get(path[0])!);
  return path;
}

function nodeLabel(id: string) {
  if (ROOM_NAMES.has(id)) return ROOM_NAMES.get(id)!;
  if (id === "entrance-mech") return "the Mechanical Gate entrance";
  const [kind, side] = id.split("-");
  return `the ${side} ${kind}`;
}

/** Map heading between two nodes, phrased as screen directions on the map (up = top of the map). */
function heading(from: GroundFloorNode, to: GroundFloorNode) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = Math.abs(dx) > 40 ? (dx > 0 ? "right" : "left") : "";
  const vertical = Math.abs(dy) > 40 ? (dy > 0 ? "down" : "up") : "";
  if (horizontal && vertical) return Math.abs(dx) > Math.abs(dy) * 2 ? horizontal : Math.abs(dy) > Math.abs(dx) * 2 ? vertical : `${vertical} and ${horizontal}`;
  return horizontal || vertical || "ahead";
}

/** A room next to a corridor, used as a landmark in spoken directions. */
function landmarkNear(corridorId: string, exclude: Set<string>) {
  const neighbours = [...(GRAPH.get(corridorId)?.keys() ?? [])].filter((id) => ROOM_NAMES.has(id) && !exclude.has(id));
  return neighbours.length ? ROOM_NAMES.get(neighbours[0]) : undefined;
}

export function planRoute(from: NavPlace, to: NavPlace): NavRoute | null {
  const nodeIds = shortestPath(from.nodeId, to.nodeId);
  if (!nodeIds) return null;
  const endpoints = new Set([from.nodeId, to.nodeId]);
  const steps: NavStep[] = [{ nodeId: from.nodeId, text: `Starting from ${from.name}.` }];
  for (let index = 1; index < nodeIds.length; index += 1) {
    const previous = NODES.get(nodeIds[index - 1])!;
    const current = NODES.get(nodeIds[index])!;
    const direction = heading(previous, current);
    const isLast = index === nodeIds.length - 1;
    if (isLast) {
      steps.push({ nodeId: current.id, text: `Go ${direction} into ${to.name}. You have arrived.` });
    } else {
      const landmark = landmarkNear(current.id, endpoints);
      const exitPhrase = index === 1 ? `Leave ${from.name} and head ${direction}` : `Continue ${direction}`;
      steps.push({ nodeId: current.id, text: `${exitPhrase} to ${nodeLabel(current.id)}${landmark ? `, near ${landmark}` : ""}.` });
    }
  }
  return { from, to, nodeIds, steps };
}

const NUMBER_WORDS: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

/** Lowercases, strips punctuation and joins spelled-out codes ("a l zero zero five" -> "al005"). */
export function normalizeSpeech(text: string) {
  const words = text.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let code = "";
  const flush = () => { if (code) { out.push(code); code = ""; } };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const previous = words[index - 1] ?? "";
    const digit = /^\d+$/.test(word) ? word : NUMBER_WORDS[word];
    const partOfCode = word.length === 1 || (digit !== undefined && (code !== "" || /^(lab|dep|al|ccf)$/.test(previous)));
    if (partOfCode) {
      code += digit ?? word;
    } else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out.join(" ");
}

function editDistanceAtMostOne(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const STOP_WORDS = new Set(["the", "a", "an", "i", "am", "im", "at", "in", "near", "to", "go", "want", "of", "and", "is", "my", "me", "take", "now", "right", "currently", "standing", "need", "reach", "get", "please", "lab"]);

function tokens(text: string) {
  return normalizeSpeech(text).split(" ").filter((token) => token && !STOP_WORDS.has(token));
}

function aliasScore(utterance: string, utteranceTokens: string[], alias: string) {
  const normalizedAlias = normalizeSpeech(alias);
  // An exact phrase hit always beats a fuzzy one; longer phrases are more specific ("canteen for staff" over "canteen").
  if (` ${utterance} `.includes(` ${normalizedAlias} `)) return 1 + normalizedAlias.length / 1000;
  const aliasTokens = tokens(alias);
  if (!aliasTokens.length) return 0;
  const hits = aliasTokens.filter((aliasToken) => utteranceTokens.some((token) => token === aliasToken || (aliasToken.length > 4 && editDistanceAtMostOne(token, aliasToken)))).length;
  // Codes such as "dep2" or "al005" must match exactly, otherwise "dep 1" would match DEP 2.
  const codesAgree = aliasTokens.filter((token) => /\d/.test(token)).every((token) => utteranceTokens.includes(token));
  if (!codesAgree) return 0;
  return (hits / aliasTokens.length) * 0.9;
}

/** Ranks places mentioned in a spoken phrase, best first. */
export function matchPlaces(utterance: string, limit = 3): PlaceMatch[] {
  const normalized = normalizeSpeech(utterance);
  const utteranceTokens = tokens(utterance);
  if (!normalized) return [];
  return NAV_PLACES
    .map((place) => ({ place, score: Math.max(...place.aliases.map((alias) => aliasScore(normalized, utteranceTokens, alias))) }))
    .filter((match) => match.score >= 0.4)
    .sort((a, b) => b.score - a.score || b.place.name.length - a.place.name.length)
    .slice(0, limit);
}

/** A confident single match, or null when the phrase is unknown or ambiguous. */
export function resolvePlace(utterance: string): NavPlace | null {
  const [best, runnerUp] = matchPlaces(utterance, 2);
  if (!best || best.score < 0.75) return null;
  if (best.score < 1 && runnerUp && best.score - runnerUp.score < 0.1) return null;
  return best.place;
}

/** Splits "from X to Y" / "I'm at X and want to go to Y" into its two halves. */
export function splitJourney(utterance: string): { from: string | null; to: string | null } {
  const text = utterance.toLowerCase();
  const toMatch = text.match(/\b(?:go(?:ing)? to|get to|take me to|reach|towards|navigate to|directions to|to)\b(.*)$/);
  const fromMatch = text.match(/\b(?:from|i am at|i'm at|im at|i am in|i'm in|i am near|i'm near|currently at|standing at|at)\b(.*?)(?=\b(?:and|go(?:ing)? to|get to|take me to|reach|navigate to|to)\b|$)/);
  return { from: fromMatch?.[1]?.trim() || null, to: toMatch?.[1]?.trim() || null };
}

export const isNextCommand = (text: string) => /\b(next|continue|done|okay|ok|reached|go on|got it)\b/i.test(text);
export const isBackCommand = (text: string) => /\b(back|previous|go back)\b/i.test(text);
export const isRepeatCommand = (text: string) => /\b(repeat|again|what|pardon|sorry)\b/i.test(text);
export const isStopCommand = (text: string) => /\b(stop|cancel|exit|quit|end|close)\b/i.test(text);
