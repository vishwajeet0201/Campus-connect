"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileImage, Settings, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassInput, GlassSheet } from "@/components/glass";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { canChangeUsername, isValidUsername } from "@/lib/profile";

type Summary = { id: string; username: string; username_changed_at: string | null; full_name: string | null; bio: string | null; avatar_url: string | null; roll_number: string | null; role: string; department_id: string | null; department_name: string | null; degree: string | null; year: number | null; posts_count: number; connections_count: number; my_connection_status: "pending" | "accepted" | "declined" | null; blocked_me: boolean; has_active_story: boolean };
type Post = { id: string; media_path: string; caption: string; created_at: string; media_url?: string };

export function ProfilePage({ username }: { username?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [privateView, setPrivateView] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [viewer, setViewer] = useState<Post | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Post | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setError("Please sign in to view your profile.");
        setLoading(false);
        return;
      }
      setMe(data.user.id);
      let target = username;
      if (!target) {
        const own = await supabase.from("profiles").select("username").eq("id", data.user.id).maybeSingle();
        target = own.data?.username ?? undefined;
      }
      const [profileResult, postResult] = await Promise.all([
        supabase.rpc("profile_summary", { profile_username: target ?? null }),
        supabase.from("posts").select("id,media_path,caption,created_at").order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      let next = (profileResult.data?.[0] ?? null) as Summary | null;
      if (!next && !username) {
        const fallback = await supabase.from("profiles").select("id,username,full_name,bio,avatar_url,roll_number,role,department_id,degree,year").eq("id", data.user.id).maybeSingle();
        if (fallback.data) {
          next = {
            ...fallback.data,
            username: fallback.data.username ?? `user-${data.user.id.slice(0, 8)}`,
            username_changed_at: null,
            department_name: null,
            posts_count: 0,
            connections_count: 0,
            my_connection_status: null,
            blocked_me: false,
            has_active_story: false,
          } as Summary;
        }
      }
      setSummary(next);
      if (!next) setPrivateView(true);
      const scopedPosts = next ? await supabase.from("posts").select("id,media_path,caption,created_at").eq("author_id", next.id).order("created_at", { ascending: false }) : { data: [] };
      const signed = scopedPosts.data?.length ? await supabase.storage.from("posts").createSignedUrls(scopedPosts.data.map((post) => post.media_path), 3600) : { data: [] };
      const signedMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
      setPosts(((scopedPosts.data ?? []) as Post[]).map((post) => ({ ...post, media_url: signedMap.get(post.media_path) ?? undefined })));
      setError(profileResult.error?.message ?? postResult.error?.message ?? "");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [supabase, username]);

  const isMe = Boolean(summary && me === summary.id);
  const connect = async () => {
    if (!summary) return;
    const previous = summary.my_connection_status;
    setSummary({ ...summary, my_connection_status: "pending" });
    const result = await supabase.rpc("connect_request", { other: summary.id });
    if (result.error) {
      setSummary({ ...summary, my_connection_status: previous });
      setError(result.error.message);
    } else if (result.data) {
      setSummary({ ...summary, my_connection_status: result.data.status });
    }
  };
  const [deleteError, setDeleteError] = useState("");
  const deletePost = async () => {
    const post = deleteCandidate;
    if (!post) return;
    if (!me || !summary || me !== summary.id) {
      setDeleteError("Only the post owner can delete this post.");
      return;
    }
    setDeleting(true);
    setDeleteError("");
    setError("");
    const result = await supabase.rpc("delete_post", { target_post: post.id });
    if (result.error) {
      setDeleting(false);
      setDeleteError(result.error.message);
      return;
    }
    const storageResult = await supabase.storage.from("posts").remove([(result.data as string | null) ?? post.media_path]);
    setDeleting(false);
    setPosts((items) => items.filter((item) => item.id !== post.id));
    setSummary((current) => current ? { ...current, posts_count: Math.max(0, current.posts_count - 1) } : current);
    setDeleteCandidate(null);
    setViewer(null);
    if (storageResult.error) setError(`Post deleted, but its image cleanup failed: ${storageResult.error.message}`);
  };
  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteCandidate(null);
    setDeleteError("");
  };
  const blockProfile = async () => {
    if (!summary || !me) return;
    const result = await supabase.from("blocks").insert({ blocker_id: me, blocked_id: summary.id });
    if (result.error) setError(result.error.message);
    else router.push("/network");
  };

  if (loading) return <main className="app-background min-h-screen p-6"><div className="mx-auto max-w-xl animate-pulse space-y-4"><div className="h-20 w-20 rounded-full bg-black/10" /><div className="h-8 rounded bg-black/10" /><div className="h-64 rounded bg-black/10" /></div></main>;
  if (privateView || !summary) return <main className="app-background min-h-screen p-6 text-center"><p className="mt-24 text-lg font-bold">This profile is unavailable</p><p className="mt-2 text-sm text-[var(--color-muted)]">The account may be private or blocked.</p></main>;

  return <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]"><div className="mx-auto max-w-3xl px-4 pb-28 pt-4">
    <GlassBar className="sticky top-3 z-20 mb-5 flex items-center justify-between px-3 py-2"><button type="button" aria-label="Back" onClick={() => router.back()}><ArrowLeft className="h-5 w-5" /></button><b>{summary.username}</b>{isMe ? <button type="button" aria-label="Settings" onClick={() => router.push("/profile/settings")}><Settings className="h-5 w-5" /></button> : <div className="relative"><button type="button" aria-label="Profile menu" onClick={() => setMenuOpen((open) => !open)}><span className="text-xl">•••</span></button>{menuOpen && <div className="surface-material absolute right-0 top-8 z-30 w-36 rounded-xl p-2 text-sm shadow-lg"><button type="button" className="block w-full p-2 text-left" onClick={() => void supabase.from("reports").insert({ reporter_id: me, target_type: "profile", target_id: summary.id, reason: "Profile report" }).then(() => setMenuOpen(false))}>Report</button><button type="button" className="block w-full p-2 text-left text-red-600" onClick={() => void blockProfile()}>Block</button></div>}</div>}</GlassBar>
    {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{error}</p>}
    <section className="flex items-center gap-5"><button type="button" className={`rounded-full p-1 ${summary.has_active_story ? "bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-400" : "bg-transparent"}`} onClick={() => summary.has_active_story && router.push("/") }><span className="block rounded-full border-4 border-[var(--color-background)]">{summary.avatar_url ? <img src={summary.avatar_url} alt="" className="h-24 w-24 rounded-full object-cover" /> : <span className="grid h-24 w-24 place-items-center rounded-full bg-[var(--color-avatar)] text-3xl font-bold text-white">{(summary.full_name ?? summary.username).slice(0, 1).toUpperCase()}</span>}</span></button><div className="grid flex-1 grid-cols-2 gap-3 text-center sm:grid-cols-3"><div><b className="block text-xl">{summary.posts_count}</b><span className="text-xs text-[var(--color-muted)]">Posts</span></div><button type="button" onClick={() => router.push(`/network/connections?user=${summary.id}`)}><b className="block text-xl">{summary.connections_count}</b><span className="text-xs text-[var(--color-muted)]">Connections</span></button><div className="col-span-2 text-left sm:col-span-1"><b className="block truncate">{summary.department_name ?? "Campus"}</b><span className="text-xs text-[var(--color-muted)]">{summary.degree ?? ""} {summary.year ?? ""}</span></div></div></section>
    <section className="mt-4"><h1 className="text-lg font-bold">{summary.full_name ?? summary.username} {["committee", "admin"].includes(summary.role) && <span className="text-blue-500">✓</span>}</h1><p className="text-sm text-[var(--color-muted)]">{summary.department_name ?? "Department"}{summary.degree ? ` - ${summary.degree}` : ""}{summary.year ? ` - Year ${summary.year}` : ""}</p>{summary.bio && <p className="mt-2 whitespace-pre-wrap text-sm">{summary.bio}</p>}{isMe && summary.roll_number && <p className="mt-2 text-xs text-[var(--color-muted)]">Roll number: {summary.roll_number}</p>}</section>
    <div className="mt-4 flex gap-2">{isMe ? <><button type="button" className="flex-1 rounded-xl border border-[var(--color-separator)] p-2 text-sm font-bold" onClick={() => setEditOpen(true)}>Edit profile</button><button type="button" className="flex-1 rounded-xl border border-[var(--color-separator)] p-2 text-sm font-bold" onClick={() => void navigator.clipboard.writeText(window.location.href)}><Share2 className="mr-1 inline h-4 w-4" />Share profile</button></> : <><button type="button" className="flex-1 rounded-xl bg-[var(--surface-primary)] p-2 text-sm font-bold text-[var(--color-on-primary)]" onClick={() => void connect()}>{summary.my_connection_status === "accepted" ? "Connected" : summary.my_connection_status === "pending" ? "Pending" : "Connect"}</button><button type="button" className="flex-1 rounded-xl border border-[var(--color-separator)] p-2 text-sm font-bold" onClick={() => router.push(`/chat/new?user=${summary.id}`)}>Message</button></>}</div>
    {isMe && <section className="mt-5 flex gap-4 overflow-x-auto"><button type="button" className="shrink-0 text-center" onClick={() => setPostOpen(true)}><span className="grid h-16 w-16 place-items-center rounded-full border border-[var(--color-separator)]"><PlusIcon /></span><small className="mt-1 block">New</small></button></section>}
    <div className="mt-5 border-b border-[var(--color-separator)] py-3 text-center text-sm font-bold">Posts</div>
    {posts.length === 0 ? <div className="py-16 text-center text-sm text-[var(--color-muted)]">No posts yet</div> : <div className="grid grid-cols-3 gap-1">{posts.map((post) => <button type="button" key={post.id} className="aspect-square bg-black/5" onClick={() => setViewer(post)}>{post.media_url && <img src={post.media_url} alt={post.caption || "Post"} className="h-full w-full object-cover" />}</button>)}</div>}
  </div><BottomTabBar active="Profile" onChange={(label) => {
    const routes: Record<string, string> = { Home: "/", Chat: "/chat", Network: "/network", Calendar: "/calendar", Profile: "/profile" };
    router.push(routes[label] ?? "/");
  }} />
  {editOpen && <EditSheet summary={summary} onClose={() => setEditOpen(false)} onSaved={(next) => { setSummary({ ...summary, ...next }); setEditOpen(false); }} supabase={supabase} />}
  {postOpen && <NewPostSheet supabase={supabase} onClose={() => setPostOpen(false)} onSaved={() => window.location.reload()} />}
  {viewer && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><GlassSheet className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-3xl p-4"><button type="button" className="float-right" onClick={() => setViewer(null)}><X /></button>{viewer.media_url && <img src={viewer.media_url} alt={viewer.caption || "Post"} className="max-h-[70vh] w-full object-contain" />}<p className="mt-3 text-sm">{viewer.caption}</p>{isMe && <button type="button" className="mt-4 text-sm font-bold text-red-600" onClick={() => { setDeleteError(""); setDeleteCandidate(viewer); }} disabled={deleting}><Trash2 className="mr-1 inline h-4 w-4" />Delete post</button>}</GlassSheet></div>}
  {deleteCandidate && <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={closeDeleteDialog}><GlassSheet className="w-full max-w-sm rounded-3xl p-5 text-center" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Delete post"><p className="text-lg font-bold">Delete this post?</p><p className="mt-1 text-sm text-[var(--color-muted)]">This removes the post and its image. It can&apos;t be undone.</p>{deleteError && <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700" role="alert">{deleteError}</p>}<div className="mt-5 flex gap-3"><button type="button" className="flex-1 rounded-xl border p-3 font-bold" onClick={closeDeleteDialog} disabled={deleting}>Cancel</button><button type="button" className="flex-1 rounded-xl bg-red-500 p-3 font-bold text-white disabled:opacity-60" onClick={() => void deletePost()} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button></div></GlassSheet></div>}
  </main>;
}

function PlusIcon() { return <span className="text-2xl">+</span>; }

function EditSheet({ summary, onClose, onSaved, supabase }: { summary: Summary; onClose: () => void; onSaved: (next: Partial<Summary>) => void; supabase: ReturnType<typeof createClient> }) {
  const [name, setName] = useState(summary.full_name ?? ""); const [username, setUsername] = useState(summary.username); const [bio, setBio] = useState(summary.bio ?? ""); const [error, setError] = useState("");
  const save = async () => { if (!isValidUsername(username)) return setError("Username must be 3-20 lowercase letters, numbers, dots or underscores."); if (bio.length > 150) return setError("Bio must be 150 characters or fewer."); if (username !== summary.username && !canChangeUsername(summary.username_changed_at)) return setError("You can change your username once every 14 days."); const result = await supabase.from("profiles").update({ full_name: name, username, bio, ...(username !== summary.username ? { username_changed_at: new Date().toISOString() } : {}) }).eq("id", summary.id); if (result.error) setError(result.error.message); else onSaved({ full_name: name, username, bio, username_changed_at: username !== summary.username ? new Date().toISOString() : summary.username_changed_at }); };
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4"><GlassSheet className="w-full max-w-lg rounded-3xl p-5"><div className="flex justify-between"><h2 className="text-xl font-bold">Edit profile</h2><button type="button" onClick={onClose}><X /></button></div>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<GlassInput className="mt-4" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /><GlassInput className="mt-3" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="Username" /><textarea className="mt-3 min-h-28 w-full rounded-xl border p-3 text-sm" maxLength={150} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Bio" /><p className="text-right text-xs text-[var(--color-muted)]">{bio.length}/150</p><button type="button" className="mt-4 w-full rounded-xl bg-[var(--surface-primary)] p-3 font-bold text-[var(--color-on-primary)]" onClick={() => void save()}>Save</button></GlassSheet></div>;
}

function NewPostSheet({ supabase, onClose, onSaved }: { supabase: ReturnType<typeof createClient>; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [caption, setCaption] = useState(""); const [error, setError] = useState("");
  const save = async () => { const user = (await supabase.auth.getUser()).data.user; if (!user || !file) return setError("Choose an image first."); if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) return setError("Use a JPG, PNG, or WEBP image under 10MB."); const path = `${user.id}/${crypto.randomUUID()}.${file.name.split(".").pop()}`; const upload = await supabase.storage.from("posts").upload(path, file, { contentType: file.type }); if (upload.error) return setError(upload.error.message); const insert = await supabase.rpc("create_post", { post_media_path: path, post_caption: caption }); if (insert.error) { await supabase.storage.from("posts").remove([path]); setError(insert.error.message); return; } onSaved(); };
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-4"><GlassSheet className="w-full max-w-lg rounded-3xl p-5"><div className="flex justify-between"><h2 className="text-xl font-bold">New post</h2><button type="button" onClick={onClose}><X /></button></div>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<label className="mt-5 flex cursor-pointer items-center justify-center rounded-xl border border-dashed p-8 text-sm"><FileImage className="mr-2" />{file?.name ?? "Choose image"}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><textarea className="mt-3 min-h-24 w-full rounded-xl border p-3 text-sm" maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Write a caption..." /><button type="button" className="mt-4 w-full rounded-xl bg-[var(--color-accent)] p-3 font-bold text-white" onClick={() => void save()}>Post</button></GlassSheet></div>;
}
