import { describe, expect, it } from "vitest";
import { GROUND_FLOOR_EDGES, GROUND_FLOOR_NODES, GROUND_FLOOR_ROOMS } from "@/lib/ground-floor";

describe("scratch ground floor graph", () => {
  it("has one canonical node and label for every room", () => {
    expect(new Set(GROUND_FLOOR_ROOMS.map((room) => room.id)).size).toBe(GROUND_FLOOR_ROOMS.length);
    expect(new Set(GROUND_FLOOR_ROOMS.map((room) => room.name)).size).toBe(GROUND_FLOOR_ROOMS.length);
    expect(GROUND_FLOOR_NODES.filter((node) => node.kind === "room")).toHaveLength(GROUND_FLOOR_ROOMS.length);
  });

  it("contains no dangling graph edges", () => {
    const nodeIds = new Set(GROUND_FLOOR_NODES.map((node) => node.id));
    for (const edge of GROUND_FLOOR_EDGES) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });
});
