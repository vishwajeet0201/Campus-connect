export type Floor = {
  id: string;
  building_id?: string;
  building_code?: string;
  building_name?: string;
  code: string;
  name: string;
  sort_order: number;
  svg_path: string;
  width: number;
  height: number;
};

export const VJTI_GROUND_FLOOR_WIDTH = 6072;
export const VJTI_GROUND_FLOOR_HEIGHT = 1510;

export type PoiCategory = {
  id: string;
  code: string;
  name: string;
  icon: string;
};

export type CampusPoi = {
  id: string;
  floor_id: string;
  building_id?: string;
  building_code?: string;
  building_name?: string;
  category_id: string;
  name: string;
  description?: string | null;
  room_code?: string | null;
  x: number;
  y: number;
  opening_hours?: string | null;
  is_accessible: boolean;
  category?: string;
  floor_code?: string;
};

export function floorLookup(floors: Floor[], buildingCode: string, floorCode: string) {
  return floors.find((floor) => floor.building_code === buildingCode && floor.code === floorCode) ?? null;
}

export function formatPoiLocation(poi: Pick<CampusPoi, "building_name" | "building_code" | "floor_code">) {
  const building = poi.building_name ?? poi.building_code ?? "Campus";
  return `${building}, ${poi.floor_code ?? "Unknown floor"}`;
}

export type StoryItem = {
  id: string;
  author_id: string;
  author: string;
  kind: "student" | "committee" | "official";
  media_path: string | null;
  media_url: string | null;
  media_type: "image" | "video";
  caption?: string | null;
  created_at: string;
  expires_at: string;
  seen?: boolean;
  verified?: boolean;
};

export function extractStoryMediaPath(mediaUrl: string | null | undefined) {
  if (!mediaUrl) return null;
  const marker = "/stories/";
  const markerIndex = mediaUrl.indexOf(marker);
  if (markerIndex === -1) return null;
  const path = mediaUrl.slice(markerIndex + marker.length).split(/[?#]/, 1)[0];
  return path || null;
}

export function getStoryErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return "We couldn't save this story. Please try again.";
  if (error.code === "23505") return "This story already exists. Please choose the media again.";
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")) {
    return "You don't have permission to post this story.";
  }
  if (/media_path.*schema cache|column.*media_path/i.test(error.message ?? "")) {
    return "Story storage is still updating. Refresh the page and try again.";
  }
  return error.message || "We couldn't save this story. Please try again.";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function worldToScreen(x: number, y: number, viewportWidth: number, viewportHeight: number, zoom: number, panX: number, panY: number) {
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  return {
    x: centerX + (x - viewportWidth / 2) * zoom + panX,
    y: centerY + (y - viewportHeight / 2) * zoom + panY,
  };
}

export function screenToWorld(x: number, y: number, viewportWidth: number, viewportHeight: number, zoom: number, panX: number, panY: number) {
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  return {
    x: (x - centerX - panX) / zoom + viewportWidth / 2,
    y: (y - centerY - panY) / zoom + viewportHeight / 2,
  };
}

export function rankPoiSearch(query: string, pois: CampusPoi[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return pois.map((poi) => ({ poi, score: 0 }));

  return pois
    .map((poi) => {
      const haystack = `${poi.name} ${poi.room_code ?? ""} ${poi.description ?? ""}`.toLowerCase();
      let score = 0;
      if (haystack.includes(normalized)) score += 10;
      if (poi.name.toLowerCase().startsWith(normalized)) score += 20;
      if (poi.room_code?.toLowerCase().startsWith(normalized)) score += 25;
      if (poi.name.toLowerCase().includes(normalized)) score += 8;
      if (poi.room_code?.toLowerCase().includes(normalized)) score += 12;
      return { poi, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ poi, score }) => ({ poi, score }));
}

export function isStoryExpired(story: Pick<StoryItem, "expires_at">, now = new Date()) {
  return new Date(story.expires_at).getTime() <= now.getTime();
}

export function evaluateStoryInsertPolicy({ kind, role, isOnboarded }: { kind: "student" | "committee" | "official"; role?: string | null; isOnboarded: boolean; }) {
  if (!isOnboarded) {
    return { allowed: false, reason: "Only onboarded users can post stories." };
  }

  if (kind === "student") {
    return { allowed: true, reason: null };
  }

  if (kind === "committee" || kind === "official") {
    if (role === "committee" || role === "admin") {
      return { allowed: true, reason: null };
    }

    return { allowed: false, reason: "Only committee or admin accounts can post committee or official stories." };
  }

  return { allowed: false, reason: "Unsupported story kind." };
}

export function getStoryDisplayDuration(story: StoryItem) {
  if (story.media_type === "video") {
    return 10; // Default to a safe 10-second fallback for video items.
  }
  return 5;
}
