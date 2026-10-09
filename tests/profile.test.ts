import { describe, expect, it } from "vitest";
import { canChangeUsername, isValidUsername, profileVisibility } from "@/lib/profile";

describe("profile helpers", () => {
  it("validates lowercase usernames", () => {
    expect(isValidUsername("vjti.student")).toBe(true);
    expect(isValidUsername("Bad Name")).toBe(false);
    expect(isValidUsername("ab")).toBe(false);
  });
  it("enforces the fourteen-day username limit", () => {
    expect(canChangeUsername("2026-10-01T00:00:00Z", new Date("2026-10-07T00:00:00Z"))).toBe(false);
    expect(canChangeUsername("2026-09-20T00:00:00Z", new Date("2026-10-07T00:00:00Z"))).toBe(true);
  });
  it("allows me and connections while hiding private strangers", () => {
    expect(profileVisibility(false, true, false)).toBe(true);
    expect(profileVisibility(false, false, true)).toBe(true);
    expect(profileVisibility(false, false, false)).toBe(false);
  });
});
