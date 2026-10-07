import { describe, expect, it } from "vitest";
import { isCollegeEmail } from "@/config/college";

describe("isCollegeEmail", () => {
  it("accepts the root college domain", () => {
    expect(isCollegeEmail("student@vjti.ac.in")).toBe(true);
  });

  it("accepts department subdomains", () => {
    expect(isCollegeEmail("student@cse.vjti.ac.in")).toBe(true);
  });

  it("accepts uppercase domains after normalization", () => {
    expect(isCollegeEmail("Student@CSE.VJTI.AC.IN")).toBe(true);
  });

  it("rejects lookalike domains", () => {
    expect(isCollegeEmail("student@evilvjti.ac.in")).toBe(false);
    expect(isCollegeEmail("student@vjti.ac.in.evil.com")).toBe(false);
  });

  it("rejects surrounding whitespace", () => {
    expect(isCollegeEmail(" student@vjti.ac.in")).toBe(false);
    expect(isCollegeEmail("student@vjti.ac.in ")).toBe(false);
  });
});