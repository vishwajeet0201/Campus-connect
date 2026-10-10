import { VJTI_GROUND } from "@/lib/maps";
import { destinations, planRoute as planOnFloor, spokenName, type Destination, type PlanRoute } from "@/lib/maps/routing";

/** A place on the VJTI ground floor a student can start from or ask for. */
export type NavPlace = Destination;
export type NavStep = PlanRoute["steps"][number];
export type NavRoute = PlanRoute;
export type PlaceMatch = { place: NavPlace; score: number };

/** Every named room, open place and gate on the ground floor. Aliases always
 * start with the place's own name; duplicates (two "Boys Washroom"s) also
 * answer to their "near ..." label. */
export const NAV_PLACES: NavPlace[] = destinations(VJTI_GROUND).map((place) => ({
  ...place,
  aliases: [...new Set([place.name, ...(place.label !== place.name ? [place.label] : []), ...place.aliases])],
}));

/** Other places with exactly the same name (e.g. the second Boys Washroom). */
export function namesakes(place: NavPlace) {
  return NAV_PLACES.filter((other) => other.name === place.name && other.id !== place.id);
}

/** Walking route between two places; for a destination that exists more than
 * once (washrooms) the nearest one is chosen. */
export function planRoute(from: NavPlace, to: NavPlace): NavRoute | null {
  return planOnFloor(VJTI_GROUND, from, to);
}

export { spokenName };

export const CATEGORY_LABELS: Record<string, string> = {
  lab: "Lab",
  room: "Room",
  office: "Office",
  faculty: "Faculty cabin",
  hall: "Hall",
  food: "Canteen",
  washroom_men: "Men's washroom",
  washroom_women: "Women's washroom",
  building: "Building",
  open: "Open area",
  sports: "Sports ground",
  garden: "Garden",
  gate: "Gate",
};

/** Typed search: prefix matches beat word-prefix matches beat substrings. */
export function searchPlaces(query: string, limit = 6): NavPlace[] {
  const q = query.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!q) return [];
  const compact = q.replace(/ /g, "");
  const score = (alias: string) => {
    const a = alias.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (a === q) return 100;
    if (a.startsWith(q)) return 90;
    if (a.replace(/ /g, "").startsWith(compact)) return 85; // "al00" -> "AL005"
    if (a.split(" ").some((word) => word.startsWith(q))) return 75;
    if (q.split(" ").every((word) => a.split(" ").some((part) => part.startsWith(word)))) return 65;
    if (a.includes(q)) return 50;
    return 0;
  };
  return NAV_PLACES
    .map((place) => ({ place, score: Math.max(...place.aliases.map(score)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.place.label.localeCompare(b.place.label))
    .slice(0, limit)
    .map((entry) => entry.place);
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
