import { describe, expect, it } from "vitest";
import { clamp, extractStoryMediaPath, isStoryExpired, rankPoiSearch, screenToWorld, worldToScreen } from "@/lib/campus";

describe("campus coordinate transforms", () => {
  it("keeps values in range when zooming at the viewport center", () => {
    const point = worldToScreen(800, 500, 1600, 1000, 1, 0, 0);
    expect(point.x).toBeCloseTo(800);
    expect(point.y).toBeCloseTo(500);

    expect(clamp(1.8, 0.75, 2.8)).toBe(1.8);
    expect(clamp(-2, 0.75, 2.8)).toBe(0.75);
  });

  it("converts screen coordinates back to world coordinates at a stable zoom", () => {
    const result = screenToWorld(800, 500, 1600, 1000, 1, 0, 0);
    expect(result.x).toBeCloseTo(800);
    expect(result.y).toBeCloseTo(500);
  });
});

describe("poi search ranking", () => {
  it("prioritises exact room and name matches over fuzzy descriptions", () => {
    const pois = [
      { id: "1", floor_id: "g", category_id: "classroom", name: "Library Annex", description: "Reading room for students", room_code: "G-03", x: 1, y: 2, is_accessible: true },
      { id: "2", floor_id: "g", category_id: "classroom", name: "Main Entrance", description: "Visitor entry", room_code: "G-01", x: 3, y: 4, is_accessible: true },
      { id: "3", floor_id: "g", category_id: "lab", name: "Electronics Lab", description: "Robot workshop", room_code: "G-201", x: 5, y: 6, is_accessible: true },
    ];

    const results = rankPoiSearch("g-201", pois);
    expect(results[0].poi.id).toBe("3");
    expect(results[0].score).toBeGreaterThan(0);
  });
});

describe("story expiry logic", () => {
  it("treats expired stories as unavailable and valid future stories as active", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(isStoryExpired({ expires_at: "2026-10-07T11:59:59Z" }, now)).toBe(true);
    expect(isStoryExpired({ expires_at: "2026-10-07T12:00:01Z" }, now)).toBe(false);
  });

  describe("story media paths", () => {
    it("extracts the object path from a stored Supabase URL", () => {
      expect(extractStoryMediaPath("https://project.supabase.co/storage/v1/object/public/stories/user-id/story.jpg")).toBe("user-id/story.jpg");
      expect(extractStoryMediaPath("https://project.supabase.co/storage/v1/object/sign/stories/user-id/story.jpg?token=abc")).toBe("user-id/story.jpg");
      expect(extractStoryMediaPath("user-id/story.jpg")).toBe(null);
    });
  });
});
