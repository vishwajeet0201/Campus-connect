import { describe, expect, it } from "vitest";
import { NAV_PLACES, matchPlaces, namesakes, normalizeSpeech, planRoute, resolvePlace, searchPlaces, splitJourney } from "@/lib/navigation";

const place = (id: string) => NAV_PLACES.find((item) => item.id === id)!;

describe("campus navigation routing", () => {
  it("can reach every ground-floor place from the main gate", () => {
    for (const target of NAV_PLACES) {
      if (target.id === "main-gate") continue;
      expect(planRoute(place("main-gate"), target), target.id).not.toBeNull();
    }
  });

  it("builds spoken steps that start at the origin and end at the destination", () => {
    const route = planRoute(place("canteen"), place("cs-it-lab-3"))!;
    expect(route.from.id).toBe("canteen");
    expect(route.to.id).toBe("cs-it-lab-3");
    expect(route.steps[0].text).toContain("Canteen");
    expect(route.steps.at(-1)!.text).toContain("You have arrived");
  });

  it("goes through the canteen to reach the staff canteen, whose only door opens into it", () => {
    const route = planRoute(place("main-gate"), place("canteen-staff"))!;
    expect(route.steps.some((step) => step.text.startsWith("Go through Canteen"))).toBe(true);
  });

  it("sends a student to the nearer of two washrooms with the same name", () => {
    expect(planRoute(place("al002"), place("boys-washroom"))!.to.id).toBe("boys-washroom-east");
    expect(planRoute(place("drives-controls-lab"), place("boys-washroom-east"))!.to.id).toBe("boys-washroom");
  });

  it("never routes over stairs", () => {
    const route = planRoute(place("auditorium"), place("bee-lab"))!;
    expect(route.nodes.length).toBeGreaterThan(2);
    expect(route.steps.every((step) => !/stair/i.test(step.text))).toBe(true);
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
    expect(resolvePlace("main gate")?.id).toBe("main-gate");
    expect(resolvePlace("mechanical gate")?.id).toBe("mechanical-gate");
  });

  it("does not guess between similar rooms", () => {
    expect(resolvePlace("washroom")).toBeNull();
    expect(matchPlaces("washroom").map((match) => match.place.id)).toEqual(expect.arrayContaining(["boys-washroom", "girls-washroom"]));
    expect(resolvePlace("pizza hut")).toBeNull();
  });

  it("labels places that share a name so they can be told apart", () => {
    const boys = place("boys-washroom");
    expect(namesakes(boys).map((p) => p.id)).toEqual(["boys-washroom-east"]);
    expect(boys.label).toMatch(/^Boys Washroom \(near .+\)$/);
    expect(place("boys-washroom-east").label).not.toBe(boys.label);
  });

  it("splits a whole journey said in one breath", () => {
    const journey = splitJourney("I am at DEP 1 and want to go to the canteen");
    expect(resolvePlace(journey.from!)?.id).toBe("dep-1");
    expect(resolvePlace(journey.to!)?.id).toBe("canteen");
    const short = splitJourney("from auditorium to library");
    expect(resolvePlace(short.from!)?.id).toBe("auditorium");
  });
});

describe("typed place search", () => {
  it("matches prefixes, codes and aliases", () => {
    expect(searchPlaces("hyd")[0]?.id).toBe("hydrology-lab");
    expect(searchPlaces("al00").map((p) => p.id)).toEqual(expect.arrayContaining(["al002", "al003", "al004", "al005"]));
    expect(searchPlaces("boys").map((p) => p.id)).toEqual(expect.arrayContaining(["boys-washroom", "boys-washroom-east"]));
    expect(searchPlaces("siemens")[0]?.id).toBe("simens-lab");
    expect(searchPlaces("")).toEqual([]);
  });
});
