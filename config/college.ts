export const ALLOWED_EMAIL_SUFFIXES = ["vjti.ac.in"] as const;
export const STORIES_BUCKET_NAME = "stories";

const EMAIL_PATTERN = /^[^@\s]+@([^@\s]+)$/;

export function isCollegeEmail(email: string): boolean {
  if (email !== email.trim()) return false;

  const match = email.match(EMAIL_PATTERN);
  if (!match) return false;

  const domain = match[1].toLowerCase();
  return ALLOWED_EMAIL_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}