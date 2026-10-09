export type ConnectionState = "none" | "pending" | "accepted" | "declined";

export function connectionAction(state: ConnectionState, isIncoming = false) {
  if (state === "accepted") return "Connected";
  if (state === "pending") return isIncoming ? "Accept" : "Pending";
  return state === "declined" ? "Connect" : "Connect";
}

export function nextConnectionState(state: ConnectionState, action: "connect" | "accept" | "decline" | "remove"): ConnectionState {
  if (action === "connect") return "pending";
  if (action === "accept") return "accepted";
  if (action === "decline" || action === "remove") return "none";
  return state;
}
