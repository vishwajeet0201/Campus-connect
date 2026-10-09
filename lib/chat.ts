export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to?: string | null;
  status?: "sending" | "failed";
};

export function validateMessageBody(body: string) {
  const value = body.trim();
  if (!value) return { valid: false, message: "Message cannot be empty." };
  if (value.length > 4000) return { valid: false, message: "Messages are limited to 4000 characters." };
  return { valid: true, value };
}

export function formatChatDate(value: string, now = new Date()) {
  const date = new Date(value);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((start.getTime() - day.getTime()) / 86400000);
  if (days === 0) return `Today ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function isUnread(createdAt: string, lastReadAt: string | null | undefined, senderId: string, currentUserId: string) {
  return senderId !== currentUserId && (!lastReadAt || new Date(createdAt) > new Date(lastReadAt));
}

export function shouldShowTimestamp(messages: ChatMessage[], index: number) {
  if (index === 0) return true;
  const previous = messages[index - 1];
  const current = messages[index];
  return previous.sender_id !== current.sender_id || new Date(current.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60 * 1000;
}
