import { describe, expect, it } from "vitest";
import { NAV_PLACES, matchPlaces, normalizeSpeech, planRoute, resolvePlace, splitJourney } from "@/lib/navigation";

const place = (id: string) => NAV_PLACES.find((item) => item.id === id)!;

describe("campus navigation routing", () => {
  it("can reach every ground-floor room from the main gate", () => {
    for (const target of NAV_PLACES) {
      if (target.id === "mechanical-gate") continue;
      expect(planRoute(place("mechanical-gate"), target), target.id).not.toBeNull();
    }
  });

  it("builds spoken steps that start at the origin and end at the destination", () => {
    const route = planRoute(place("canteen"), place("cs-it-lab-3"))!;
    expect(route.nodeIds[0]).toBe("room-canteen");
    expect(route.nodeIds.at(-1)).toBe("room-cs-it-lab-3");
    expect(route.steps[0].text).toContain("Canteen");
    expect(route.steps.at(-1)!.text).toContain("You have arrived");
  });

  it("never routes through stairs", () => {
    const route = planRoute(place("auditorium"), place("bee-lab"))!;
    expect(route.nodeIds.some((id) => id.startsWith("stairs"))).toBe(false);
  });
});

describe("spoken place matching", () => {
  it("joins spelled-out room codes", () => {
    expect(normalizeSpeech("A L zero zero five")).toBe("al005");
    expect(normalizeSpeech("DEP two")).toBe("dep 2");
  });

  it("resolves names, aliases and codes", () => {
    expect(resolvePlace("I'm at the canteen")?.id).toBe("canteen");
    expect(resolvePlace("cafeteria")?.id).toBe("canteen");
    expect(resolvePlace("staff canteen")?.id).toBe("canteen-staff");
    expect(resolvePlace("a l zero zero five")?.id).toBe("al005");
    expect(resolvePlace("dep 2")?.id).toBe("dep-2");
    expect(resolvePlace("siemens high voltage lab")?.id).toBe("simens-lab");
    expect(resolvePlace("the auditorium please")?.id).toBe("auditorium");
  });

  it("does not guess between similar rooms", () => {
    expect(resolvePlace("washroom")).toBeNull();
    expect(matchPlaces("washroom").map((match) => match.place.id)).toEqual(expect.arrayContaining(["boys-washroom", "girls-washroom"]));
    expect(resolvePlace("pizza hut")).toBeNull();
  });

  it("splits a whole journey said in one breath", () => {
    const journey = splitJourney("I am at DEP 1 and want to go to the canteen");
    expect(resolvePlace(journey.from!)?.id).toBe("dep-1");
    expect(resolvePlace(journey.to!)?.id).toBe("canteen");
    const short = splitJourney("from auditorium to library");
    expect(resolvePlace(short.from!)?.id).toBe("auditorium");
  });
});
