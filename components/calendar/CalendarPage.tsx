"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Pin, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { GlassBar, GlassButton, GlassInput, GlassSheet } from "@/components/glass";
import { istDateKey, monthGrid, NATIONAL_HOLIDAYS_2026, relativeCalendarTime } from "@/lib/calendar";

type Holiday = { id: string; date: string; name: string; kind: "institute" | "national" | "exam_break" };
type EventItem = { id: string; title: string; description: string; location: string | null; starts_at: string; ends_at: string; all_day: boolean };
type Announcement = { id: string; title: string; body: string; tag: "general" | "academic" | "exam" | "event" | "placement" | "urgent"; pinned: boolean; department_id: string | null; author_id: string; created_at: string; expires_at: string | null; attachment_path: string | null; author?: { full_name: string | null; username: string | null } | null; read?: boolean };

const tags = ["all", "academic", "exam", "event", "placement", "urgent", "department"];
const tagLabel = (tag: string) => tag === "all" ? "All" : tag === "department" ? "My department" : tag[0].toUpperCase() + tag.slice(1) + (tag === "exam" ? "s" : tag === "event" ? "s" : "");

export function CalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = istDateKey(new Date());
  const initialDate = searchParams.get("date") ?? today;
  const [cursor, setCursor] = useState(() => new Date(`${initialDate}T12:00:00`));
  const [selectedDate, setSelectedDate] = useState<string | null>(searchParams.get("date"));
  const [filter, setFilter] = useState("all");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [role, setRole] = useState("student");
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const [compose, setCompose] = useState(false);
  const [composeTab, setComposeTab] = useState<"announcement" | "event" | "holiday">("announcement");
  const [error, setError] = useState("");
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = useMemo(() => monthGrid(year, month), [month, year]);
  const holidaysByDate = useMemo(() => holidays.reduce((map, item) => {
    const items = map.get(item.date) ?? [];
    items.push(item);
    map.set(item.date, items);
    return map;
  }, new Map<string, Holiday[]>()), [holidays]);
  const eventDates = useMemo(() => new Set(events.map((item) => istDateKey(item.starts_at))), [events]);
  const unreadOnly = searchParams.get("unread") === "1";
  const visibleAnnouncements = useMemo(() => announcements.filter((item) => filter === "all" || (filter === "department" ? Boolean(item.department_id) : item.tag === filter)).filter((item) => !selectedDate || istDateKey(item.created_at) === selectedDate).filter((item) => !unreadOnly || !item.read), [announcements, filter, selectedDate, unreadOnly]);
  const unreadCount = announcements.filter((item) => !item.read).length;
  const upcoming = [...holidays.map((item) => ({ date: item.date, title: item.name, kind: "holiday" })), ...events.map((item) => ({ date: istDateKey(item.starts_at), title: item.title, kind: "event" }))].filter((item) => item.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  const selectedHolidays = selectedDate ? holidaysByDate.get(selectedDate) ?? [] : [];
  const selectedEvents = selectedDate ? events.filter((item) => istDateKey(item.starts_at) === selectedDate) : [];

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: authData }) => Promise.all([
      supabase.from("holidays").select("id,date,name,kind").order("date"),
      supabase.from("events").select("id,title,description,location,starts_at,ends_at,all_day").order("starts_at"),
      supabase.from("announcements").select("id,title,body,tag,pinned,department_id,author_id,created_at,expires_at,attachment_path,author:profiles!announcements_author_id_fkey(full_name,username)").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("role").eq("id", authData.user?.id ?? "").maybeSingle(),
      supabase.from("announcement_reads").select("announcement_id").eq("user_id", authData.user?.id ?? ""),
    ])).then(([holidayResult, eventResult, announcementResult, profileResult, readResult]) => {
      if (cancelled) return;
      const databaseHolidays = (holidayResult.data ?? []) as Holiday[];
      const storedHolidayKeys = new Set(databaseHolidays.map((item) => `${item.date}:${item.name}`));
      const fallbackHolidays = NATIONAL_HOLIDAYS_2026
        .filter(([date, name]) => !storedHolidayKeys.has(`${date}:${name}`))
        .map(([date, name]) => ({ id: `national-${date}-${name}`, date, name, kind: "national" as const }));
      setHolidays([...databaseHolidays, ...fallbackHolidays].sort((a, b) => a.date.localeCompare(b.date)));
      setEvents((eventResult.data ?? []) as EventItem[]);
      const readIds = new Set((readResult.data ?? []).map((item) => item.announcement_id));
      setAnnouncements((announcementResult.data ?? []).map((item) => ({ ...item, author: Array.isArray(item.author) ? item.author[0] ?? null : item.author, read: readIds.has(item.id) })) as Announcement[]);
      setRole(profileResult.data?.role ?? "student");
      setError(holidayResult.error?.message ?? eventResult.error?.message ?? announcementResult.error?.message ?? profileResult.error?.message ?? readResult.error?.message ?? "");
    });
    return () => { cancelled = true; };
  }, [supabase]);

  const chooseDate = (date: string) => {
    setSelectedDate(date);
    router.replace(`/calendar?date=${date}`);
  };
  const moveMonth = (delta: number) => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  const markRead = async (announcement: Announcement) => {
    let selected = announcement;
    if (announcement.attachment_path) {
      const signed = await supabase.storage.from("announcements").createSignedUrl(announcement.attachment_path, 3600);
      if (signed.data?.signedUrl) selected = { ...announcement, attachment_path: signed.data.signedUrl };
    }
    setOpenAnnouncement(selected);
    await supabase.from("announcement_reads").upsert({ announcement_id: announcement.id, user_id: (await supabase.auth.getUser()).data.user?.id, read_at: new Date().toISOString() });
    setAnnouncements((items) => items.map((item) => item.id === announcement.id ? { ...item, read: true } : item));
  };
  const manage = role === "admin" || role === "committee";

  return <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]"><div className="mx-auto max-w-5xl px-4 py-6 pb-28">
    <header className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">    CampusConnect</p><h1 className="mt-1 text-4xl font-bold tracking-[-0.04em]">Calendar</h1></div><GlassBar className="flex items-center gap-2 px-3 py-2"><Bell className="h-4 w-4" /><a href="/api/calendar/export" className="text-xs font-semibold">Export .ics</a></GlassBar></header>
    {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{error}</p>}
    <section className="surface-flat rounded-[var(--radius-card)] border border-[var(--color-separator)] p-4">
      <div className="flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft /></button><h2 className="text-lg font-bold">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2><button type="button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight /></button></div>
      <div className="mt-3 flex justify-center"><button type="button" className="filter-chip" onClick={() => { setCursor(new Date(`${today}T12:00:00`)); chooseDate(today); }}>Today</button></div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[var(--color-muted)]">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mt-2 grid grid-cols-7 gap-1">{days.map((date, index) => date ? <button type="button" key={date} onClick={() => chooseDate(date)} className={`relative grid h-11 place-items-center rounded-xl text-sm ${date === selectedDate ? "ring-2 ring-[var(--color-accent)]" : ""} ${date === today ? "bg-blue-600 font-bold text-white" : ""} ${holidaysByDate.has(date) ? "bg-red-100 text-red-700" : ""} ${index % 7 === 6 && date !== today && !holidaysByDate.has(date) ? "text-[var(--color-secondary)]" : ""}`}><span>{Number(date.slice(-2))}</span>{eventDates.has(date) && <i className="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--color-accent)]" />}</button> : <span key={`empty-${index}`} />)}</div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--color-muted)]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600" />Today</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Holiday</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />Event</span></div>
    </section>
    {selectedDate && <section className="mt-4 space-y-2"><button type="button" className="filter-chip" onClick={() => { setSelectedDate(null); router.replace("/calendar"); }}>Show all</button>{selectedHolidays.map((holiday) => <div key={holiday.id} className="rounded-xl bg-red-100 p-3 text-sm font-semibold text-red-700">{holiday.name}</div>)}{selectedEvents.map((event) => <div key={event.id} className="surface-flat rounded-xl border border-[var(--color-separator)] p-3"><b>{event.title}</b><p className="text-sm text-[var(--color-muted)]">{event.location ?? "Campus event"}</p></div>)}</section>}
    {upcoming.length > 0 && <section className="mt-5"><h2 className="mb-2 text-sm font-bold">Upcoming</h2><div className="flex gap-2 overflow-x-auto">{upcoming.map((item) => <div key={`${item.kind}-${item.date}-${item.title}`} className="surface-flat min-w-36 rounded-xl border border-[var(--color-separator)] p-3"><p className="text-xs text-[var(--color-muted)]">{item.date}</p><b className="mt-1 block truncate text-sm">{item.title}</b></div>)}</div></section>}
    <div className="mt-5 flex gap-2 overflow-x-auto pb-1">{tags.map((tag) => <button type="button" key={tag} className={`filter-chip whitespace-nowrap ${filter === tag ? "is-active" : ""}`} onClick={() => setFilter(tag)}>{tagLabel(tag)}</button>)}</div>
    <section className="mt-4 space-y-3">{visibleAnnouncements.map((announcement) => <button type="button" key={announcement.id} className="surface-flat block w-full rounded-[var(--radius-card)] border border-[var(--color-separator)] p-4 text-left" onClick={() => void markRead(announcement)}><div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${announcement.tag === "urgent" ? "bg-red-100 text-red-700" : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"}`}>{announcement.tag}</span>{announcement.pinned && <Pin className="h-4 w-4" />}</div><h3 className="mt-2 font-bold">{announcement.title}</h3><p className="mt-1 line-clamp-3 text-sm text-[var(--color-muted)]">{announcement.body}</p><p className="mt-3 text-xs text-[var(--color-muted)]">{announcement.author?.full_name ?? announcement.author?.username ?? "Campus team"} · {relativeCalendarTime(announcement.created_at)}{!announcement.read && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />}</p></button>)}</section>
    {manage && <GlassButton surface="glass" className="fixed bottom-24 right-5 grid h-14 w-14 place-items-center rounded-full" aria-label="Create calendar item" onClick={() => setCompose(true)}><Plus /></GlassButton>}
    {openAnnouncement && <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4" onClick={() => setOpenAnnouncement(null)}><GlassSheet className="w-full max-w-2xl rounded-3xl p-6" onClick={(event) => event.stopPropagation()}><button type="button" className="float-right" onClick={() => setOpenAnnouncement(null)}><X /></button><span className="text-xs font-bold uppercase text-[var(--color-accent)]">{openAnnouncement.tag}</span><h2 className="mt-2 text-2xl font-bold">{openAnnouncement.title}</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{openAnnouncement.body}</p>{openAnnouncement.attachment_path && <a className="mt-5 inline-block font-semibold text-[var(--color-accent)]" href={openAnnouncement.attachment_path}>Download attachment</a>}</GlassSheet></div>}
    {compose && <ComposeSheet tab={composeTab} setTab={setComposeTab} onClose={() => setCompose(false)} supabase={supabase} onSaved={() => window.location.reload()} />}
  </div><BottomTabBar active="Calendar" calendarBadge={unreadCount} onChange={(label) => {
    const routes: Record<string, string> = { Home: "/", Chat: "/chat", Network: "/network", Calendar: "/calendar", Profile: "/profile" };
    router.push(routes[label] ?? "/");
  }} /></main>;
}

function ComposeSheet({ tab, setTab, onClose, supabase, onSaved }: { tab: "announcement" | "event" | "holiday"; setTab: (tab: "announcement" | "event" | "holiday") => void; onClose: () => void; supabase: ReturnType<typeof createClient>; onSaved: () => void }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [date, setDate] = useState(""); const [kind, setKind] = useState("institute"); const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); const user = (await supabase.auth.getUser()).data.user; if (!user) return; const result = tab === "announcement" ? await supabase.from("announcements").insert({ title, body, tag: "general", author_id: user.id }) : tab === "event" ? await supabase.from("events").insert({ title, description: body, starts_at: new Date(date).toISOString(), ends_at: new Date(date).toISOString(), created_by: user.id }) : await supabase.from("holidays").insert({ date, name: title, kind, created_by: user.id }); setSaving(false); if (result.error) window.alert(result.error.message); else onSaved(); };
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4"><GlassSheet className="w-full max-w-2xl rounded-3xl p-6"><div className="flex justify-between"><div className="flex gap-2">{(["announcement", "event", "holiday"] as const).map((item) => <button type="button" key={item} className={`filter-chip ${tab === item ? "is-active" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</div><button type="button" onClick={onClose}><X /></button></div><GlassInput className="mt-5" placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} /><textarea className="mt-3 min-h-32 w-full rounded-xl border border-[var(--color-separator)] bg-white p-3 text-sm" placeholder={tab === "holiday" ? "Holiday name" : "Description"} value={body} onChange={(event) => setBody(event.target.value)} /><GlassInput className="mt-3" type={tab === "announcement" ? "text" : "datetime-local"} value={date} onChange={(event) => setDate(event.target.value)} placeholder={tab === "announcement" ? "Expiry (optional)" : "Date and time"} />{tab === "holiday" && <select className="mt-3 w-full rounded-xl border p-3" value={kind} onChange={(event) => setKind(event.target.value)}><option value="institute">Institute</option><option value="exam_break">Exam break</option></select>}<button type="button" disabled={saving} className="mt-5 w-full rounded-xl bg-[var(--surface-primary)] p-3 font-bold text-[var(--color-on-primary)]" onClick={() => void save()}>{saving ? "Saving..." : "Save"}</button></GlassSheet></div>;
}
