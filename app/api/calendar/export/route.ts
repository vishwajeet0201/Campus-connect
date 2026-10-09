import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const [{ data: holidays }, { data: events }] = await Promise.all([
    supabase.from("holidays").select("date,name").order("date"),
    supabase.from("events").select("title,description,location,starts_at,ends_at,all_day").order("starts_at"),
  ]);
  const holidayRows = (holidays ?? []).map((holiday) => `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${String(holiday.date).replaceAll("-", "")}\r\nSUMMARY:${holiday.name}\r\nEND:VEVENT`);
  const eventRows = (events ?? []).map((event) => {
    const start = new Date(event.starts_at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const end = new Date(event.ends_at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return `BEGIN:VEVENT\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${event.title}\r\nDESCRIPTION:${(event.description ?? "").replaceAll("\n", "\\n")}\r\nLOCATION:${event.location ?? ""}\r\nEND:VEVENT`;
  });
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//  CampusConnect//Calendar//EN", ...holidayRows, ...eventRows, "END:VCALENDAR"].join("\r\n");
  return new NextResponse(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="  campusconnect-calendar.ics"' } });
}
