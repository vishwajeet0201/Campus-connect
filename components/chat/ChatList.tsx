"use client";

import { MessageCircle, MessageCirclePlus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassButton, GlassInput } from "@/components/glass";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { formatChatDate } from "@/lib/chat";

type ChatRow = { conversation_id: string; other_user_id: string; other_full_name: string | null; other_username: string | null; other_avatar_url: string | null; last_message_body: string | null; last_message_created_at: string | null; unread_count: number; muted: boolean };
type Profile = { id: string; full_name: string | null; username: string | null; department_id: string | null; department?: { name: string }[] | null };

export function ChatList() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [query, setQuery] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [students, setStudents] = useState<Profile[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("chat_list").select("*").order("last_message_at", { ascending: false, nullsFirst: false });
      if (active) {
        setRows((data ?? []) as ChatRow[]);
        setState(error ? "error" : "ready");
      }
    }
    void load();
    const channel = supabase.channel("chat-list").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void load()).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    if (!newChatOpen || studentQuery.trim().length < 2) return;
    const timer = window.setTimeout(async () => {
      const term = `%${studentQuery.trim()}%`;
      const { data: departments } = await supabase.from("departments").select("id").ilike("name", term);
      const departmentIds = (departments ?? []).map((department) => department.id);
      const filters = [`full_name.ilike.${term}`, `username.ilike.${term}`];
      if (departmentIds.length > 0) filters.push(`department_id.in.(${departmentIds.join(",")})`);
      const { data } = await supabase.from("profiles").select("id,full_name,username,department_id,department:departments(name)").eq("visible_in_directory", true).eq("onboarded", true).or(filters.join(",")).limit(20);
      setStudents((data ?? []) as Profile[]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [newChatOpen, studentQuery, supabase]);

  const filtered = rows.filter((row) => `${row.other_full_name ?? ""} ${row.other_username ?? ""} ${row.last_message_body ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const openDm = async (userId: string) => {
    const { data, error } = await supabase.rpc("get_or_create_dm", { other_user: userId });
    if (!error && data) router.push(`/chat/${data}`);
  };

  return (
    <main className="chat-page app-background scroll-shell text-[var(--color-ink)]">
      <div className="chat-content">
        <header className="chat-list-header"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">        CampusConnect</p><h1 className="mt-1 text-4xl font-bold tracking-[-0.04em]">Chat</h1></div><GlassButton surface="glass" className="new-chat-button grid h-12 w-12 place-items-center rounded-full" aria-label="New chat" onClick={() => setNewChatOpen(true)}><MessageCirclePlus className="h-5 w-5" /></GlassButton></header>
        <GlassBar className="chat-search flex items-center gap-3 px-4 py-2"><Search className="h-5 w-5 text-[var(--color-muted)]" /><GlassInput className="border-0 bg-transparent p-0 shadow-none focus:bg-transparent" placeholder="Search chats" aria-label="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} /></GlassBar>
        {state === "loading" && <div className="chat-list">{[1, 2, 3].map((item) => <div className="chat-row chat-skeleton" key={item} />)}</div>}
        {state === "error" && <div className="chat-empty"><p>Couldn&apos;t load your chats.</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
        {state === "ready" && filtered.length === 0 && <div className="chat-empty"><MessageCircle className="h-8 w-8" /><p>{query ? "No chats match your search." : "Start a conversation with a classmate."}</p></div>}
        {filtered.length > 0 && <div className="chat-list">{filtered.map((row) => <button type="button" className="chat-row" key={row.conversation_id} onClick={() => router.push(`/chat/${row.conversation_id}`)}><span className="chat-avatar">{(row.other_full_name ?? row.other_username ?? "?").slice(0, 1).toUpperCase()}</span><span className="chat-row-copy"><strong>{row.other_full_name ?? row.other_username ?? "Student"}</strong><span>{row.last_message_body ?? "No messages yet"}</span></span><span className="chat-row-meta">{row.last_message_created_at && formatChatDate(row.last_message_created_at)}{row.unread_count > 0 && <b>{row.unread_count}</b>}</span></button>)}</div>}
      </div>
      <BottomTabBar active="Chat" onChange={(label) => label === "Home" ? router.push("/") : undefined} />
      {newChatOpen && <div className="chat-scrim" onClick={() => { setNewChatOpen(false); setStudentQuery(""); setStudents([]); }}><section className="new-chat-sheet surface-flat" onClick={(event) => event.stopPropagation()}><header><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">New message</p><h2 className="text-2xl font-bold">Choose a student</h2></div><button type="button" onClick={() => { setNewChatOpen(false); setStudentQuery(""); setStudents([]); }} aria-label="Close"><X /></button></header><div className="mt-5 flex items-center gap-2 rounded-2xl border border-[var(--color-separator)] px-3 py-2"><Search className="h-4 w-4 text-[var(--color-muted)]" /><input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Name, username or department" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} /></div><div className="mt-4">{students.map((student) => <button type="button" className="student-result" key={student.id} onClick={() => void openDm(student.id)}><span className="chat-avatar">{(student.full_name ?? student.username ?? "?").slice(0, 1).toUpperCase()}</span><span><strong>{student.full_name ?? student.username}</strong><small>@{student.username ?? "student"}{student.department?.[0]?.name ? ` · ${student.department[0].name}` : ""}</small></span></button>)}{studentQuery.length >= 2 && students.length === 0 && <p className="py-6 text-center text-sm text-[var(--color-muted)]">No students found.</p>}</div></section></div>}
    </main>
  );
}
