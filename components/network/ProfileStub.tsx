"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function ProfileStub({ username }: { username: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [profile, setProfile] = useState<{ full_name: string | null; username: string | null; avatar_url: string | null } | null>(null);
  useEffect(() => {
    void supabase.from("profiles").select("full_name,username,avatar_url").eq("username", username).maybeSingle().then(({ data }) => setProfile(data));
  }, [supabase, username]);
  return <main className="app-background scroll-shell min-h-screen p-5 text-[var(--color-ink)]"><button type="button" className="mb-8 flex items-center gap-2 text-sm font-semibold" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /> Back</button><section className="surface-flat max-w-xl rounded-[var(--radius-card)] border border-[var(--color-separator)] p-6"><div className="flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-avatar)] text-white">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full object-cover" /> : <UserRound />}</span><div><h1 className="text-2xl font-bold">{profile?.full_name ?? profile?.username ?? username}</h1><p className="text-sm text-[var(--color-muted)]">@{profile?.username ?? username}</p></div></div></section></main>;
}
