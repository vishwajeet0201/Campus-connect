export function isValidUsername(value: string) {
  return /^[a-z0-9._]{3,20}$/.test(value);
}

export function canChangeUsername(lastChangedAt: string | null, now = new Date()) {
  if (!lastChangedAt) return true;
  return now.getTime() - new Date(lastChangedAt).getTime() >= 14 * 24 * 60 * 60 * 1000;
}

export function profileVisibility(visibleInDirectory: boolean, isMe: boolean, connected: boolean) {
  return isMe || visibleInDirectory || connected;
}
