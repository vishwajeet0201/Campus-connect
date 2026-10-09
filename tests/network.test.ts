import { describe, expect, it } from "vitest";
import { connectionAction, nextConnectionState } from "@/lib/network";

describe("connection state machine", () => {
  it("moves through request, acceptance and removal", () => {
    expect(nextConnectionState("none", "connect")).toBe("pending");
    expect(nextConnectionState("pending", "accept")).toBe("accepted");
    expect(nextConnectionState("accepted", "remove")).toBe("none");
  });

  it("labels incoming and outgoing pending requests", () => {
    expect(connectionAction("pending", true)).toBe("Accept");
    expect(connectionAction("pending", false)).toBe("Pending");
  });
});
