import { describe, expect, it } from "vitest";
import { formatChatDate, isUnread, shouldShowTimestamp, validateMessageBody } from "@/lib/chat";

describe("chat validation and grouping", () => {
  it("validates message length and whitespace", () => {
    expect(validateMessageBody("   ").valid).toBe(false);
    expect(validateMessageBody("hello").value).toBe("hello");
    expect(validateMessageBody("x".repeat(4001)).valid).toBe(false);
  });
  it("formats today and yesterday labels", () => {
    const now = new Date("2026-10-07T16:00:00");
    expect(formatChatDate("2026-10-07T15:41:00", now)).toBe("Today 3:41 PM");
    expect(formatChatDate("2026-10-06T15:41:00", now)).toBe("Yesterday");
  });
  it("calculates unread messages and group breaks", () => {
    expect(isUnread("2026-10-07T16:00:00Z", "2026-10-07T15:00:00Z", "other", "me")).toBe(true);
    const messages = [
      { id: "1", conversation_id: "c", sender_id: "me", body: "one", created_at: "2026-10-07T10:00:00Z" },
      { id: "2", conversation_id: "c", sender_id: "me", body: "two", created_at: "2026-10-07T10:01:00Z" },
      { id: "3", conversation_id: "c", sender_id: "other", body: "three", created_at: "2026-10-07T10:02:00Z" },
    ];
    expect(shouldShowTimestamp(messages, 0)).toBe(true);
    expect(shouldShowTimestamp(messages, 1)).toBe(false);
    expect(shouldShowTimestamp(messages, 2)).toBe(true);
  });
});
