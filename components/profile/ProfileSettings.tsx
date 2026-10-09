"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LogOut, Shield, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function ProfileSettings() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [visible, setVisible] = useState(true);
  const [mute, setMute] = useState(false);
  const [alerts, setAlerts] = useState(true);
  const [appearance, setAppearance] = useState("system");
  const [userId, setUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const profile = await supabase.from("profiles").select("visible_in_directory").eq("id", data.user.id).maybeSingle();
      const settings = await supabase.from("user_settings").select("mute_chat_sounds,announcement_alerts,appearance").eq("user_id", data.user.id).maybeSingle();
      setVisible(profile.data?.visible_in_directory ?? true);
      setMute(settings.data?.mute_chat_sounds ?? false);
      setAlerts(settings.data?.announcement_alerts ?? true);
      setAppearance(settings.data?.appearance ?? "system");
    });
  }, [supabase]);
  const updateProfile = async (value: boolean) => {
    setVisible(value);
    const result = await supabase.from("profiles").update({ visible_in_directory: value }).eq("id", userId ?? "");
    if (result.error) setMessage(result.error.message);
  };
  const updateSettings = async (patch: Record<string, boolean | string>) => {
    const result = await supabase.from("user_settings").upsert({ user_id: userId, ...patch });
    if (result.error) setMessage(result.error.message);
  };
  return <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]"><div className="mx-auto max-w-2xl px-4 py-5 pb-10"><header className="flex items-center gap-3"><button type="button" onClick={() => router.back()}><ArrowLeft /></button><h1 className="text-2xl font-bold">Settings</h1></header>{message && <p className="mt-3 text-sm text-red-600">{message}</p>}<section className="mt-6 space-y-4"><div className="surface-flat rounded-2xl border border-[var(--color-separator)] p-4"><h2 className="font-bold">Privacy</h2><label className="mt-4 flex items-center justify-between gap-4 text-sm"><span><b>Show me in the student directory</b><small className="mt-1 block text-[var(--color-muted)]">People can find you in Network search and department lists.</small></span><input type="checkbox" checked={visible} onChange={(event) => void updateProfile(event.target.checked)} /></label><button type="button" className="mt-4 flex items-center gap-2 text-sm font-semibold" onClick={() => router.push("/network/requests")}><Shield className="h-4 w-4" />Manage connections and blocks</button></div><div className="surface-flat rounded-2xl border border-[var(--color-separator)] p-4"><h2 className="font-bold">Appearance</h2><select className="mt-3 w-full rounded-xl border p-3" value={appearance} onChange={(event) => { setAppearance(event.target.value); void updateSettings({ appearance: event.target.value }); }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div><div className="surface-flat rounded-2xl border border-[var(--color-separator)] p-4"><h2 className="font-bold">Notifications</h2><label className="mt-3 flex justify-between text-sm">Mute chat sounds <input type="checkbox" checked={mute} onChange={(event) => { setMute(event.target.checked); void updateSettings({ mute_chat_sounds: event.target.checked }); }} /></label><label className="mt-3 flex justify-between text-sm">Announcement alerts <input type="checkbox" checked={alerts} onChange={(event) => { setAlerts(event.target.checked); void updateSettings({ announcement_alerts: event.target.checked }); }} /></label></div><div className="surface-flat rounded-2xl border border-[var(--color-separator)] p-4"><h2 className="font-bold">Account</h2><button type="button" className="mt-4 flex items-center gap-2 text-sm font-semibold" onClick={() => void supabase.auth.signOut({ scope: "global" })}><LogOut className="h-4 w-4" />Sign out all devices</button><button type="button" className="mt-4 flex items-center gap-2 text-sm font-semibold text-red-600" onClick={() => { if (window.confirm("Request account deletion?")) void supabase.from("profiles").update({ account_deletion_requested_at: new Date().toISOString() }).eq("id", userId ?? ""); }}><UserX className="h-4 w-4" />Request account deletion</button></div><p className="text-xs text-[var(--color-muted)]">  CampusConnect v0.1 · <a href="mailto:support@example.com">Report a problem</a></p></section></div></main>;
}
