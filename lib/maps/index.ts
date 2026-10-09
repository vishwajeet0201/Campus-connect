import vjtiGround from "./data/vjti-G.json";
import type { FloorPlan } from "./types";

export type { FloorPlan } from "./types";

/** Interactive vector plans (rooms, doors, navigation graph). */
export const VJTI_GROUND: FloorPlan = vjtiGround as unknown as FloorPlan;

const PLANS: Record<string, FloorPlan> = { "VJTI:G": VJTI_GROUND };

/** Verified stitched images for floors that don't have a vector plan yet.
 * Sizes are the stitched images' pixel dimensions (tools/mapstitch/reports). */
export type FloorImage = { src: string; width: number; height: number; partial?: string };

const IMAGES: Record<string, FloorImage> = {
  "VJTI:1": { src: "/maps/stitched/vjti-1.png", width: 2488, height: 1849 },
  "VJTI:2": { src: "/maps/stitched/vjti-2.png", width: 1697, height: 1509 },
  "VJTI:3": { src: "/maps/stitched/vjti-3.png", width: 951, height: 455 },
  "MECH:G": { src: "/maps/stitched/mech-G.png", width: 2697, height: 1680 },
  "MECH:1": { src: "/maps/stitched/mech-1.png", width: 1060, height: 1030, partial: "The east wing (DL 201, DL 202 and the faculty cabins) isn't shown yet: the screenshots of this floor don't overlap, so its position can't be verified." },
  "MECH:2": { src: "/maps/stitched/mech-2.png", width: 2286, height: 994 },
  "MECH:3": { src: "/maps/stitched/mech-3.png", width: 832, height: 254 },
  "MECH:TPO": { src: "/maps/stitched/mech-TPO.png", width: 942, height: 604 },
};

const key = (building?: string, floor?: string) => `${building ?? ""}:${floor ?? ""}`;

export function planFor(building?: string, floor?: string): FloorPlan | null {
  return PLANS[key(building, floor)] ?? null;
}

export function imageFor(building?: string, floor?: string): FloorImage | null {
  return IMAGES[key(building, floor)] ?? null;
}
