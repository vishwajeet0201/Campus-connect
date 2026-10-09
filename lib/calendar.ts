export const CALENDAR_TIME_ZONE = "Asia/Kolkata";
export const WEEK_STARTS_ON = 1;

export const NATIONAL_HOLIDAYS_2026 = [
  ["2026-01-26", "Republic Day"],
  ["2026-02-15", "Mahashivratri"],
  ["2026-02-19", "Chhatrapati Shivaji Maharaj Jayanti"],
  ["2026-03-03", "Holi (Second Day)"],
  ["2026-03-19", "Gudhi Padwa"],
  ["2026-03-21", "Ramzan Eid (Eid-ul-Fitr)"],
  ["2026-03-26", "Ram Navami"],
  ["2026-03-31", "Mahavir Janma Kalyanak"],
  ["2026-04-03", "Good Friday"],
  ["2026-04-14", "Dr. Babasaheb Ambedkar Jayanti"],
  ["2026-05-01", "Maharashtra Day"],
  ["2026-05-02", "Buddha Purnima"],
  ["2026-05-28", "Bakri Eid (Eid-ul-Adha)"],
  ["2026-06-26", "Muharram"],
  ["2026-08-15", "Independence Day"],
  ["2026-08-15", "Parsi New Year (Jamshedi Navroz)"],
  ["2026-08-26", "Eid-e-Milad"],
  ["2026-09-14", "Ganesh Chaturthi"],
  ["2026-10-02", "Mahatma Gandhi Jayanti"],
  ["2026-10-20", "Dussehra (Vijayadashami)"],
  ["2026-11-08", "Diwali Amavasya (Lakshmi Pujan)"],
  ["2026-11-10", "Diwali - Balipratipada"],
  ["2026-11-24", "Gurunanak Jayanti"],
  ["2026-12-25", "Christmas"],
] as const;

export function istDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day < 1 || day > days ? null : `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

export function relativeCalendarTime(value: string, now = new Date()) {
  const delta = Math.round((now.getTime() - new Date(value).getTime()) / 60000);
  if (delta < 60) return `${Math.max(delta, 1)}m ago`;
  if (delta < 1440) return `${Math.round(delta / 60)}h ago`;
  return `${Math.round(delta / 1440)}d ago`;
}
