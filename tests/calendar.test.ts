import { describe, expect, it } from "vitest";
import { istDateKey, monthGrid, NATIONAL_HOLIDAYS_2026 } from "@/lib/calendar";

describe("calendar helpers", () => {
  it("keeps late-night IST timestamps on the IST date", () => {
    expect(istDateKey("2026-01-26T23:30:00+05:30")).toBe("2026-01-26");
  });
  it("handles leap years and Monday-first boundaries", () => {
    expect(monthGrid(2028, 1)).toHaveLength(35);
    expect(monthGrid(2026, 2).filter(Boolean)).toHaveLength(31);
    expect(monthGrid(2026, 2).filter(Boolean)[0]).toBe("2026-03-01");
  });
  it("contains the complete 2026 national holiday catalog", () => {
    expect(NATIONAL_HOLIDAYS_2026).toHaveLength(24);
    expect(NATIONAL_HOLIDAYS_2026.filter(([date]) => date === "2026-08-15")).toHaveLength(2);
    expect(NATIONAL_HOLIDAYS_2026).toContainEqual(["2026-10-02", "Mahatma Gandhi Jayanti"]);
  });
});
