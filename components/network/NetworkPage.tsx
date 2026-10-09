"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, MessageCircle, Network as NetworkIcon, Search, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassInput } from "@/components/glass";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { nextConnectionState, type ConnectionState } from "@/lib/network";

type Department = { id: string; name: string; code: string; student_count: number };
type Student = { id: string; full_name: string | null; username: string | null; bio: string | null; avatar_url: string | null; department_id: string | null; department_name: string | null; degree: "diploma" | "btech" | "mtech" | null; year: number | null; connection_status: ConnectionState | null; connection_id: string | null };

export function NetworkPage({ departmentCode, initialDegree = "btech", initialYear, mode = "directory" }: { departmentCode?: string; initialDegree?: string; initialYear?: number; mode?: "directory" | "connections" | "requests" }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [degree, setDegree] = useState(initialDegree);
  const [year, setYear] = useState(initialYear);
  const selectedDepartment = useMemo(() => departmentCode ? departments.find((item) => item.code.toLowerCase() === departmentCode.toLowerCase()) ?? null : null, [departmentCode, departments]);
  const [loading, setLoading] = useState(Boolean(departmentCode));
  const [error, setError] = useState("");
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, [supabase]);

  useEffect(() => {
    void supabase.rpc("directory_departments").then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      setDepartments((data ?? []) as Department[]);
    });
  }, [supabase]);

  useEffect(() => {
    if (mode === "directory" && !query.trim() && !selectedDepartment) {
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const { data, error: rpcError } = await supabase.rpc(mode === "directory" ? "directory_students" : "directory_relationships", mode === "directory" ? {
        dept: selectedDepartment?.id ?? null,
        degree_filter: selectedDepartment && !query.trim() ? degree : null,
        year_filter: selectedDepartment && !query.trim() ? year ?? null : null,
        query_text: query.trim() || null,
        page_limit: 20,
        page_offset: 0,
      } : { kind: mode });
      setStudents((data ?? []) as Student[]);
      setError(rpcError?.message ?? "");
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [degree, mode, query, selectedDepartment, supabase, year]);

  const updateConnection = async (student: Student, action: "connect" | "accept" | "decline" | "remove") => {
    const previous = student.connection_status ?? "none";
    const optimistic = nextConnectionState(previous, action);
    setStudents((current) => current.map((item) => item.id === student.id ? { ...item, connection_status: optimistic } : item));
    let rpcError = null;
    if (action === "connect") {
      const result = await supabase.rpc("connect_request", { other: student.id });
      rpcError = result.error;
    } else if (action === "remove" && student.connection_id) {
      rpcError = (await supabase.from("connections").delete().eq("id", student.connection_id)).error;
    } else if ((action === "accept" || action === "decline") && student.connection_id) {
      rpcError = (await supabase.from("connections").update({ status: action === "accept" ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", student.connection_id)).error;
    }
    if (rpcError) {
      setStudents((current) => current.map((item) => item.id === student.id ? { ...item, connection_status: previous } : item));
      setError(rpcError.message);
    }
  };

  const availableYears = degree === "diploma" ? [1, 2, 3] : degree === "mtech" ? [1, 2] : [1, 2, 3, 4];
  return <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]">
    <div className="mx-auto max-w-5xl px-4 py-6 pb-28">
      <header className="mb-5 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">      CampusConnect</p><h1 className="mt-1 text-4xl font-bold tracking-[-0.04em]">Network</h1></div><NetworkIcon className="h-8 w-8 text-[var(--color-accent)]" /></header>
      <GlassBar className="flex items-center gap-3 px-4 py-2"><Search className="h-5 w-5 text-[var(--color-muted)]" /><GlassInput className="border-0 bg-transparent p-0 shadow-none focus:bg-transparent" placeholder="Search name, username or roll number" value={query} onChange={(event) => setQuery(event.target.value)} /></GlassBar>
      {error && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{error}</p>}
      {mode === "directory" && !query && !selectedDepartment && <><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{departments.map((department) => <button key={department.id} type="button" className="surface-flat rounded-[var(--radius-card)] border border-[var(--color-separator)] p-4 text-left" onClick={() => router.push(`/network/${department.code.toLowerCase()}`)}><div className="flex items-center justify-between"><div><h2 className="font-bold">{department.name}</h2><p className="text-xs text-[var(--color-muted)]">{department.code}</p></div><ChevronRight className="h-5 w-5 text-[var(--color-muted)]" /></div><p className="mt-4 text-sm text-[var(--color-muted)]">{department.student_count} students</p></button>)}</div><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" className="surface-flat rounded-[var(--radius-card)] border border-[var(--color-separator)] p-4 text-left" onClick={() => router.push("/network/connections")}><b>My connections</b><p className="mt-1 text-sm text-[var(--color-muted)]">View and manage your network</p></button><button type="button" className="surface-flat rounded-[var(--radius-card)] border border-[var(--color-separator)] p-4 text-left" onClick={() => router.push("/network/requests")}><b>Requests</b><p className="mt-1 text-sm text-[var(--color-muted)]">Review incoming and outgoing requests</p></button></div></>}
      {selectedDepartment && <><div className="mt-5 flex items-center justify-between"><div><h2 className="text-2xl font-bold">{selectedDepartment.name}</h2><p className="text-sm text-[var(--color-muted)]">{selectedDepartment.code}</p></div><button type="button" className="text-sm font-semibold" onClick={() => router.push("/network")}>All departments</button></div><div className="mt-4 flex gap-2">{["diploma", "btech", "mtech"].map((item) => <button key={item} type="button" className={`filter-chip ${degree === item ? "is-active" : ""}`} onClick={() => { setDegree(item); setYear(undefined); router.replace(`/network/${selectedDepartment.code.toLowerCase()}?degree=${item}`); }}>{item === "btech" ? "BTech" : item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className="mt-3 flex gap-2">{availableYears.map((item) => <button key={item} type="button" className={`filter-chip ${year === item ? "is-active" : ""}`} onClick={() => { setYear(item); router.replace(`/network/${selectedDepartment.code.toLowerCase()}?degree=${degree}&year=${item}`); }}>{item}</button>)}</div></>}
      {mode !== "directory" && <h2 className="mt-6 text-2xl font-bold">{mode === "connections" ? "My connections" : "Requests"}</h2>}
      {(query || selectedDepartment || mode !== "directory") && <section className="mt-5 space-y-2">{loading ? [1, 2, 3].map((item) => <div className="h-20 animate-pulse rounded-2xl bg-black/5" key={item} />) : students.length === 0 ? <div className="surface-flat rounded-2xl border border-[var(--color-separator)] p-8 text-center text-sm text-[var(--color-muted)]">No students found.</div> : students.map((student) => <div key={student.id} className="surface-flat flex items-center gap-3 rounded-2xl border border-[var(--color-separator)] p-3"><button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => student.username && router.push(`/u/${student.username}`)}><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--color-avatar)] font-bold text-white">{student.avatar_url ? <img src={student.avatar_url} alt="" className="h-full w-full rounded-full object-cover" /> : (student.full_name ?? student.username ?? "S").slice(0, 1).toUpperCase()}</span><span className="min-w-0"><b className="block truncate">{student.full_name ?? student.username ?? "Student"}{student.id === viewerId && <span className="ml-2 rounded-full bg-[var(--surface-primary)] px-2 py-0.5 align-middle text-[10px] font-bold text-[var(--color-on-primary)]">You</span>}</b><small className="block truncate text-[var(--color-muted)]">@{student.username ?? "student"}{student.bio ? ` · ${student.bio}` : ""}</small></span></button>{student.id !== viewerId && <><button type="button" className="rounded-full border border-[var(--color-separator)] p-2" aria-label="Message" onClick={() => router.push(`/chat/new?user=${student.id}`)}><MessageCircle className="h-4 w-4" /></button><button type="button" className="rounded-full bg-[var(--surface-primary)] px-3 py-2 text-xs font-bold text-[var(--color-on-primary)]" onClick={() => void updateConnection(student, student.connection_status === "pending" ? "accept" : student.connection_status === "accepted" ? "remove" : "connect")}>{student.connection_status === "accepted" ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}</button></>}</div>)}</section>}
    </div><BottomTabBar active="Network" onChange={(label) => {
      const routes: Record<string, string> = { Home: "/", Chat: "/chat", Network: "/network", Calendar: "/calendar", Profile: "/profile" };
      router.push(routes[label] ?? "/");
    }} />
  </main>;
}
