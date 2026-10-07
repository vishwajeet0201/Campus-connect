"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarDays, ChevronRight, Clock3, Home, MessageCircle, Navigation, Network, Pause, Search, SlidersHorizontal, Upload, UserRound, Verified, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassButton, GlassCard, GlassInput } from "@/components/glass";
import { CampusMapViewer, type MapFloor, type MapPoi } from "@/components/map/CampusMapViewer";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { extractStoryMediaPath, isStoryExpired, rankPoiSearch, type StoryItem } from "@/lib/campus";

const floors: MapFloor[] = [
  { id: "g", code: "G", name: "Ground Floor", sort_order: 0, svg_path: "/maps/floor-G.svg", width: 1600, height: 1000 },
  { id: "1", code: "1", name: "First Floor", sort_order: 1, svg_path: "/maps/floor-1.svg", width: 1600, height: 1000 },
  { id: "2", code: "2", name: "Second Floor", sort_order: 2, svg_path: "/maps/floor-2.svg", width: 1600, height: 1000 },
];

const poiSeed: MapPoi[] = [
  { id: "poi-1", floor_id: "g", category_id: "cat-entrance", name: "Main Entrance", description: "Visitor entry and campus access", room_code: "G-01", x: 240, y: 760, opening_hours: "08:00-18:00", is_accessible: true, category: "entrance", floor_code: "G" },
  { id: "poi-2", floor_id: "g", category_id: "cat-office", name: "Admissions Office", description: "Student support and admissions desk", room_code: "G-02", x: 500, y: 700, opening_hours: "09:00-17:00", is_accessible: true, category: "office", floor_code: "G" },
  { id: "poi-3", floor_id: "g", category_id: "cat-library", name: "Library Annex", description: "Study hall and reading lounge", room_code: "G-03", x: 820, y: 440, opening_hours: "08:30-18:30", is_accessible: true, category: "library", floor_code: "G" },
  { id: "poi-4", floor_id: "g", category_id: "cat-canteen", name: "Cafeteria", description: "Main canteen and snack stall", room_code: "G-04", x: 1120, y: 320, opening_hours: "09:00-20:00", is_accessible: true, category: "canteen", floor_code: "G" },
  { id: "poi-5", floor_id: "g", category_id: "cat-stairs", name: "North Stairwell", description: "Vertical access", room_code: "G-05", x: 660, y: 600, opening_hours: null, is_accessible: true, category: "stairs", floor_code: "G" },
  { id: "poi-6", floor_id: "g", category_id: "cat-lift", name: "Lift Lobby A", description: "Accessible lift", room_code: "G-06", x: 760, y: 610, opening_hours: null, is_accessible: true, category: "lift", floor_code: "G" },
  { id: "poi-7", floor_id: "g", category_id: "cat-ramp", name: "Barrier-free Route", description: "Accessible ramp", room_code: "G-07", x: 920, y: 740, opening_hours: null, is_accessible: true, category: "ramp", floor_code: "G" },
  { id: "poi-8", floor_id: "g", category_id: "cat-classroom", name: "Room G-101", description: "Lecture room", room_code: "G-101", x: 360, y: 500, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "G" },
  { id: "poi-9", floor_id: "g", category_id: "cat-classroom", name: "Room G-102", description: "Seminar hall", room_code: "G-102", x: 500, y: 500, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "G" },
  { id: "poi-10", floor_id: "g", category_id: "cat-lab", name: "Electronics Lab", description: "Circuit design and robotics lab", room_code: "G-201", x: 350, y: 300, opening_hours: "09:00-18:00", is_accessible: true, category: "lab", floor_code: "G" },
  { id: "poi-11", floor_id: "g", category_id: "cat-toilet-men", name: "Men's Toilet", description: "Ground floor washroom", room_code: "G-401", x: 1100, y: 690, opening_hours: "06:00-22:00", is_accessible: true, category: "toilet_men", floor_code: "G" },
  { id: "poi-12", floor_id: "g", category_id: "cat-toilet-women", name: "Women's Toilet", description: "Ground floor washroom", room_code: "G-402", x: 1210, y: 690, opening_hours: "06:00-22:00", is_accessible: true, category: "toilet_women", floor_code: "G" },
  { id: "poi-13", floor_id: "1", category_id: "cat-entrance", name: "North Entrance", description: "First-floor entry plaza", room_code: "1-01", x: 300, y: 730, opening_hours: "08:00-18:00", is_accessible: true, category: "entrance", floor_code: "1" },
  { id: "poi-14", floor_id: "1", category_id: "cat-classroom", name: "Room 101", description: "Lecture hall", room_code: "1-101", x: 430, y: 520, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "1" },
  { id: "poi-15", floor_id: "1", category_id: "cat-classroom", name: "Room 102", description: "Tutorial block", room_code: "1-102", x: 570, y: 520, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "1" },
  { id: "poi-16", floor_id: "1", category_id: "cat-classroom", name: "Room 103", description: "Applied mathematics classroom", room_code: "1-103", x: 710, y: 520, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "1" },
  { id: "poi-17", floor_id: "1", category_id: "cat-library", name: "Reading Lounge", description: "Quiet study area", room_code: "1-302", x: 1120, y: 430, opening_hours: "09:00-18:00", is_accessible: true, category: "library", floor_code: "1" },
  { id: "poi-18", floor_id: "1", category_id: "cat-lab", name: "Physics Lab", description: "Experiments and instruments", room_code: "1-201", x: 420, y: 280, opening_hours: "09:00-17:00", is_accessible: true, category: "lab", floor_code: "1" },
  { id: "poi-19", floor_id: "1", category_id: "cat-stairs", name: "West Stairwell", description: "Access to upper levels", room_code: "1-501", x: 740, y: 740, opening_hours: null, is_accessible: true, category: "stairs", floor_code: "1" },
  { id: "poi-20", floor_id: "1", category_id: "cat-lift", name: "Lift Lobby B", description: "Accessible elevator", room_code: "1-502", x: 810, y: 760, opening_hours: null, is_accessible: true, category: "lift", floor_code: "1" },
  { id: "poi-21", floor_id: "1", category_id: "cat-ramp", name: "Accessible Ramp", description: "Wheelchair route", room_code: "1-503", x: 920, y: 760, opening_hours: null, is_accessible: true, category: "ramp", floor_code: "1" },
  { id: "poi-22", floor_id: "2", category_id: "cat-entrance", name: "South Entrance", description: "Upper campus access", room_code: "2-601", x: 250, y: 760, opening_hours: "08:00-18:00", is_accessible: true, category: "entrance", floor_code: "2" },
  { id: "poi-23", floor_id: "2", category_id: "cat-classroom", name: "Room 201", description: "Engineering drawing studio", room_code: "2-101", x: 420, y: 540, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "2" },
  { id: "poi-24", floor_id: "2", category_id: "cat-classroom", name: "Room 202", description: "Project room", room_code: "2-102", x: 580, y: 540, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "2" },
  { id: "poi-25", floor_id: "2", category_id: "cat-classroom", name: "Room 203", description: "Senior design studio", room_code: "2-103", x: 730, y: 540, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "2" },
  { id: "poi-26", floor_id: "2", category_id: "cat-classroom", name: "Room 204", description: "Computer lab", room_code: "2-104", x: 960, y: 540, opening_hours: "08:00-17:00", is_accessible: true, category: "classroom", floor_code: "2" },
  { id: "poi-27", floor_id: "2", category_id: "cat-lab", name: "Innovation Lab", description: "Prototype and fabrication lab", room_code: "2-201", x: 420, y: 260, opening_hours: "09:00-17:30", is_accessible: true, category: "lab", floor_code: "2" },
  { id: "poi-28", floor_id: "2", category_id: "cat-lab", name: "Research Lab", description: "Applied research and testing", room_code: "2-202", x: 690, y: 260, opening_hours: "09:00-17:30", is_accessible: true, category: "lab", floor_code: "2" },
  { id: "poi-29", floor_id: "2", category_id: "cat-conference", name: "Boardroom", description: "A/V enabled meeting room", room_code: "2-301", x: 1000, y: 320, opening_hours: "09:00-18:00", is_accessible: true, category: "conference", floor_code: "2" },
  { id: "poi-30", floor_id: "2", category_id: "cat-library", name: "Archives", description: "Reference resources", room_code: "2-302", x: 1110, y: 420, opening_hours: "09:00-17:00", is_accessible: true, category: "library", floor_code: "2" },
  { id: "poi-31", floor_id: "2", category_id: "cat-offce", name: "Student Council Office", description: "Campus leadership office", room_code: "2-303", x: 980, y: 700, opening_hours: "09:00-17:00", is_accessible: true, category: "office", floor_code: "2" },
  { id: "poi-32", floor_id: "2", category_id: "cat-toilet-men", name: "Men's Toilet", description: "Upper floor washroom", room_code: "2-401", x: 1170, y: 250, opening_hours: "06:00-22:00", is_accessible: true, category: "toilet_men", floor_code: "2" },
  { id: "poi-33", floor_id: "2", category_id: "cat-toilet-women", name: "Women's Toilet", description: "Upper floor washroom", room_code: "2-402", x: 1290, y: 250, opening_hours: "06:00-22:00", is_accessible: true, category: "toilet_women", floor_code: "2" },
  { id: "poi-34", floor_id: "2", category_id: "cat-stairs", name: "East Stairwell", description: "Upper floor connection", room_code: "2-501", x: 760, y: 760, opening_hours: null, is_accessible: true, category: "stairs", floor_code: "2" },
  { id: "poi-35", floor_id: "2", category_id: "cat-lift", name: "Lift Lobby C", description: "Accessible lift", room_code: "2-502", x: 870, y: 760, opening_hours: null, is_accessible: true, category: "lift", floor_code: "2" },
  { id: "poi-36", floor_id: "2", category_id: "cat-ramp", name: "Accessible Route", description: "Ramp to common area", room_code: "2-503", x: 960, y: 760, opening_hours: null, is_accessible: true, category: "ramp", floor_code: "2" },
];

const storySeed: StoryItem[] = [
  { id: "story-your", author_id: "me", author: "You", kind: "student", media_path: null, media_url: "/images/story-1.jpg", media_type: "image", caption: "My favourite spot on campus before lecture block.", created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 22).toISOString(), seen: false, verified: false },
  { id: "story-aarav", author_id: "aarav", author: "Aarav", kind: "student", media_path: null, media_url: "/images/story-2.jpg", media_type: "image", caption: "Campus sunrise from the robotics lab.", created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 18).toISOString(), seen: false, verified: false },
  { id: "story-committee", author_id: "committee", author: "Student Council", kind: "committee", media_path: null, media_url: "/images/story-3.jpg", media_type: "image", caption: "Orientation week schedule is live.", created_at: new Date(Date.now() - 1000 * 60 * 50).toISOString(), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 9).toISOString(), seen: true, verified: true },
  { id: "story-official", author_id: "official", author: "Campus Admin", kind: "official", media_path: null, media_url: "/images/story-4.jpg", media_type: "image", caption: "Safety reminder: Library annex closes at 18:30.", created_at: new Date(Date.now() - 1000 * 60 * 70).toISOString(), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 10).toISOString(), seen: false, verified: true },
];

const filterOptions = [
  { label: "All", value: "all" },
  { label: "Classrooms", value: "classroom" },
  { label: "Labs", value: "lab" },
  { label: "Toilets", value: "toilets" },
  { label: "Canteen", value: "canteen" },
  { label: "Library", value: "library" },
  { label: "Offices", value: "office" },
];

export function AppShell() {
  const [activeTab, setActiveTab] = useState("Home");
  const [activeFloorId, setActiveFloorId] = useState(floors[0].id);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedPoi, setSelectedPoi] = useState<MapPoi | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [storyIndex, setStoryIndex] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [stories, setStories] = useState<StoryItem[]>(storySeed);
  const [storyFailures, setStoryFailures] = useState<Record<string, boolean>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [storyDraft, setStoryDraft] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const timerRef = useRef<number | null>(null);
  const refreshAttemptsRef = useRef<Record<string, number>>({});
  const supabase = useMemo(() => createClient(), []);

  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0];
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return rankPoiSearch(query, poiSeed.filter((poi) => poi.floor_id === activeFloorId)).slice(0, 5);
  }, [activeFloorId, query]);

  const activeStories = useMemo(() => stories.filter((story) => !isStoryExpired(story)), [stories]);
  const currentStory = storyIndex == null ? null : activeStories[storyIndex] ?? null;

  const signStories = useCallback(async (items: StoryItem[]) => {
    const paths = items.map((story) => story.media_path ?? extractStoryMediaPath(story.media_url)).filter((path): path is string => Boolean(path));
    if (!paths.length) return items;
    const { data, error } = await supabase.storage.from("stories").createSignedUrls([...new Set(paths)], 60 * 60);
    if (error) {
      if (process.env.NODE_ENV === "development") console.warn("Could not sign story media URLs:", error.message);
      return items;
    }
    const signedUrls = new Map((data ?? []).map((entry) => [entry.path, entry.signedUrl]));
    return items.map((story) => {
      const path = story.media_path ?? extractStoryMediaPath(story.media_url);
      return path && signedUrls.get(path) ? { ...story, media_path: path, media_url: signedUrls.get(path) ?? null } : story;
    });
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    async function loadStories() {
      const { data, error } = await supabase
        .from("stories")
        .select("id,author_id,kind,media_url,media_path,media_type,caption,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) {
        if (process.env.NODE_ENV === "development") console.warn("Could not load stories:", error.message);
        return;
      }
      const rows = (data ?? []).map((row) => ({
        ...row,
        author: row.author_id,
        media_path: row.media_path ?? extractStoryMediaPath(row.media_url),
        seen: false,
        verified: row.kind !== "student",
      })) as StoryItem[];
      const signedStories = await signStories(rows);
      if (!cancelled) setStories(signedStories);
    }
    void loadStories();
    return () => { cancelled = true; };
  }, [signStories, supabase]);

  const openStory = (index: number) => {
    if (activeStories[index]) {
      setStoryIndex(index);
    }
  };

  const closeStory = () => setStoryIndex(null);

  const handleSearchSelect = (poi: MapPoi) => {
    setQuery("");
    setActiveFloorId(poi.floor_id);
    setSelectedPoi(poi);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isImage && !isVideo) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      return;
    }
    const url = URL.createObjectURL(file);
    setStoryDraft({ url, type: isVideo ? "video" : "image" });
  };

  const postStory = async () => {
    if (!storyDraft) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const extension = storyDraft.type === "video" ? "mp4" : "jpg";
    const mediaPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const file = await (await fetch(storyDraft.url)).blob();
    const { error: uploadError } = await supabase.storage.from("stories").upload(mediaPath, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      if (process.env.NODE_ENV === "development") console.warn("Could not upload story media:", uploadError.message);
      return;
    }
    const { data, error } = await supabase.from("stories").insert({
      author_id: user.id,
      kind: "student",
      media_path: mediaPath,
      media_url: mediaPath,
      media_type: storyDraft.type,
      caption: caption || null,
    }).select("id,author_id,kind,media_url,media_path,media_type,caption,created_at,expires_at").single();
    if (error || !data) {
      if (process.env.NODE_ENV === "development") console.warn("Could not save story:", error?.message ?? "No story returned");
      return;
    }
    const [signedStory] = await signStories([{ ...data, author: "You", seen: false, verified: false } as StoryItem]);
    setStories((current) => [signedStory ?? data as StoryItem, ...current]);
    setComposerOpen(false);
    setCaption("");
    URL.revokeObjectURL(storyDraft.url);
    setStoryDraft(null);
    setStoryIndex(0);
  };

  const handleStoryMediaError = async (story: StoryItem) => {
    if (process.env.NODE_ENV === "development" && story.media_url) {
      try {
        const response = await fetch(story.media_url, { method: "HEAD" });
        console.warn(`Story media failed with HTTP ${response.status}:`, story.id);
      } catch {
        console.warn("Story media failed before an HTTP status was available:", story.id);
      }
    }
    if (!story.media_path || (refreshAttemptsRef.current[story.id] ?? 0) >= 1) {
      setStoryFailures((current) => ({ ...current, [story.id]: true }));
      return;
    }
    refreshAttemptsRef.current[story.id] = (refreshAttemptsRef.current[story.id] ?? 0) + 1;
    const [refreshed] = await signStories([story]);
    if (refreshed?.media_url && refreshed.media_url !== story.media_url) {
      setStories((current) => current.map((item) => item.id === story.id ? refreshed : item));
    } else {
      setStoryFailures((current) => ({ ...current, [story.id]: true }));
    }
  };

  const retryStory = async (story: StoryItem) => {
    refreshAttemptsRef.current[story.id] = 0;
    setStoryFailures((current) => ({ ...current, [story.id]: false }));
    await handleStoryMediaError({ ...story, media_url: null });
  };

  const onStoryAdvance = (direction: "next" | "prev") => {
    if (storyIndex == null) return;
    if (direction === "next") {
      setStoryIndex((current) => (current === null || current >= activeStories.length - 1 ? 0 : current + 1));
    } else {
      setStoryIndex((current) => (current === null || current <= 0 ? activeStories.length - 1 : current - 1));
    }
  };

  const onStoryTimer = () => {
    if (storyIndex == null) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onStoryAdvance("next");
    }, currentStory?.media_type === "video" ? 10000 : 5000);
  };

  if (activeTab !== "Home") {
    return <PlaceholderScreen activeTab={activeTab} onChange={setActiveTab} />;
  }

  return (
    <main className="app-background home-shell relative min-h-screen text-[var(--color-ink)]">
      <div className="home-map-layer" aria-label="Campus map preview">
        <CampusMapViewer floors={floors} pois={poiSeed} activeFloorId={activeFloorId} selectedPoiId={selectedPoi?.id ?? null} onSelectPoi={setSelectedPoi} onMapTap={() => setSelectedPoi(null)} onPanningChange={setIsPanning} categoryFilter={categoryFilter} query={query} />
      </div>

      <div className="home-top-overlay">
        <div className="home-top-inner flex flex-col gap-2">
          <header className="flex items-center justify-between gap-3 px-1">
            <div className="home-heading">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI / CampusGlass</p>
              <h1 className="text-lg font-bold tracking-[-0.02em]">Good morning, student.</h1>
            </div>
            <GlassButton surface="glass" className="grid h-10 w-10 shrink-0 place-items-center" aria-label="Notifications">
              <Bell className="h-5 w-5" />
            </GlassButton>
          </header>

          <div className="relative">
            <GlassBar className="search-bar home-search flex items-center gap-3 px-4 py-2">
              <Search className="h-5 w-5 shrink-0 text-[var(--color-ink)] opacity-65" />
              <GlassInput className="border-0 bg-transparent p-0 shadow-none focus:bg-transparent" placeholder="Search campus" aria-label="Search campus" value={query} onChange={(event) => setQuery(event.target.value)} />
              <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--color-ink)]" aria-label="Open filters">
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </GlassBar>
            {searchResults.length > 0 && (
              <GlassCard surface="material" className="search-dropdown absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden p-1">
                {searchResults.map(({ poi }) => (
                  <button key={poi.id} className="search-result flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm hover:bg-white/8" onClick={() => handleSearchSelect(poi)}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{poi.name}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{poi.room_code} · {floors.find((floor) => floor.id === poi.floor_id)?.code}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--color-muted)]" />
                  </button>
                ))}
              </GlassCard>
            )}
          </div>

          <div className="story-strip-wrap">
            <section aria-label="Stories" className="home-stories flex gap-3 overflow-x-auto px-1 pb-1" data-collapsed={isPanning}>
              <motion.button whileTap={{ scale: 0.94 }} className="flex min-w-[68px] flex-col items-center gap-1" aria-label="Create your story" onClick={() => setComposerOpen(true)}>
                <span className="story-ring relative grid h-16 w-16 place-items-center rounded-full p-[2px]" data-seen={true}>
                  <span className="story-avatar grid h-full w-full place-items-center rounded-full text-sm font-bold">+</span>
                </span>
                <span className="max-w-16 truncate text-[11px] font-medium text-[var(--color-ink)] opacity-75">Your story</span>
              </motion.button>

              {activeStories.map((story, index) => {
                const seen = story.seen ?? false;
                return (
                  <motion.button whileTap={{ scale: 0.94 }} key={story.id} className="flex min-w-[68px] flex-col items-center gap-1" aria-label={story.author} onClick={() => openStory(index)}>
                    <span className="story-ring relative grid h-16 w-16 place-items-center rounded-full p-[2px]" data-seen={seen}>
                      <span className="story-avatar grid h-full w-full place-items-center rounded-full text-sm font-bold">{story.author.slice(0, 1).toUpperCase()}</span>
                      {story.verified && <span className="story-verified absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-on-primary)]"><Verified className="h-3 w-3" /></span>}
                    </span>
                    <span className="max-w-16 truncate text-[11px] font-medium text-[var(--color-ink)] opacity-75">{story.author}</span>
                  </motion.button>
                );
              })}
            </section>
          </div>

          <div className="category-filter-row flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => (
              <button key={option.value} type="button" className={`filter-chip ${categoryFilter === option.value ? "is-active" : ""}`} onClick={() => setCategoryFilter(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="map-tools">
        <GlassBar className="floor-pill">
          {floors.map((floor) => (
            <button key={floor.id} type="button" data-active={floor.id === activeFloorId} onClick={() => setActiveFloorId(floor.id)}>
              {floor.code}
            </button>
          ))}
        </GlassBar>
        <GlassButton surface="glass" className="directions-button" aria-label="Directions">
          <Navigation className="h-5 w-5 text-[var(--color-accent)]" />
        </GlassButton>
      </div>

      <AnimatePresence>
        {selectedPoi && (
          <motion.div initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }} className="poi-sheet-container">
            <motion.div drag="y" dragConstraints={{ top: 0, bottom: 0 }} onDragEnd={(_, info) => { if (info.offset.y > 80) setSelectedPoi(null); }} className="poi-bottom-sheet surface-material p-4">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--color-separator)]" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">{selectedPoi.floor_code} · {selectedPoi.category}</p>
                  <h2 className="mt-1 text-xl font-bold">{selectedPoi.name}</h2>
                </div>
                <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent)]">
                  {selectedPoi.is_accessible ? "Accessible" : "Limited access"}
                </span>
              </div>

              <div className="poi-meta mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                {selectedPoi.room_code && <div className="flex items-center gap-2"><span className="font-medium text-[var(--color-ink)]">Room</span> <span>{selectedPoi.room_code}</span></div>}
                {selectedPoi.opening_hours && <div className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> <span>{selectedPoi.opening_hours}</span></div>}
              </div>

              <div className="mt-4 flex gap-2">
                <GlassButton className="flex-1" variant="default" disabled>
                  Directions
                </GlassButton>
                <GlassButton className="flex-1" variant="default" disabled>
                  Report issue
                </GlassButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomTabBar active={activeTab} onChange={setActiveTab} />

      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {composerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="story-composer-backdrop" onClick={() => setComposerOpen(false)}>
            <motion.div initial={{ y: 32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }} onClick={(event) => event.stopPropagation()} className="story-composer surface-flat p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold">Create story</h3>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10" onClick={() => setComposerOpen(false)} aria-label="Close composer"><X className="h-4 w-4" /></button>
              </div>

              {!storyDraft ? (
                <label className="story-picker flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-white/30 bg-white/5 p-6 text-center text-sm text-[var(--color-muted)]">
                  <Upload className="h-5 w-5" />
                  <span>Choose an image or video</span>
                  <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFileSelect} />
                </label>
              ) : (
                <div className="story-preview-space">
                  {storyDraft.type === "image" ? <img src={storyDraft.url} alt="Story preview" className="story-preview-image" /> : <video src={storyDraft.url} className="story-preview-video" controls />}
                  <textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Add a caption…" className="story-caption mt-3 w-full rounded-2xl border border-white/20 bg-white/5 p-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)]" rows={3} />
                  <div className="mt-3 flex gap-2">
                    <GlassButton type="button" className="flex-1" onClick={() => setStoryDraft(null)}>Replace</GlassButton>
                    <GlassButton type="button" variant="primary" className="flex-1" onClick={postStory} disabled={!storyDraft}>Post</GlassButton>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {reportOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="story-composer-backdrop" onClick={() => setReportOpen(false)}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(event) => event.stopPropagation()} className="report-dialog surface-flat p-5">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">Story report</p><h2 className="mt-2 text-xl font-bold">Report this story?</h2></div>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-separator)]" onClick={() => setReportOpen(false)} aria-label="Close report dialog"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">Choose Report issue from the story menu to send this story for review.</p>
              <div className="mt-5 flex justify-end gap-2"><GlassButton type="button" onClick={() => setReportOpen(false)}>Cancel</GlassButton><GlassButton type="button" variant="primary" onClick={() => setReportOpen(false)}>Report</GlassButton></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}

      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {currentStory && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="story-viewer">
            <div className="story-viewer-overlay" onClick={() => closeStory()} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="story-viewer-content">
              <div className="story-progress-wrap mt-4 flex gap-1 px-4">
                {activeStories.map((story, index) => (
                  <span key={story.id} className={`story-progress ${index === storyIndex ? "is-active" : ""}`} />
                ))}
              </div>
              <header className="story-header flex items-center justify-between px-4 pb-3 pt-4">
                <div className="flex items-center gap-3">
                  <span className="story-avatar story-avatar--viewer grid h-10 w-10 place-items-center rounded-full text-sm font-bold">{currentStory.author.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{currentStory.author}</p>
                      {currentStory.verified && <Verified className="h-3.5 w-3.5 text-[var(--color-accent)]" />}
                    </div>
                    <p className="text-[11px] text-[var(--color-muted)]">{new Date(currentStory.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                </div>
                <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold" onClick={closeStory}>Close</button>
              </header>

              <div className="story-media-wrap">
                {storyFailures[currentStory.id] || !currentStory.media_url ? (
                  <div className="story-media-fallback">
                    <p>Couldn&apos;t load this story</p>
                    <GlassButton type="button" className="mt-3 px-4 py-2 text-xs font-semibold" onClick={() => void retryStory(currentStory)}>Retry</GlassButton>
                  </div>
                ) : currentStory.media_type === "image" ? (
                  <img src={currentStory.media_url} alt={currentStory.caption ?? "Story media"} className="story-media" onError={() => void handleStoryMediaError(currentStory)} />
                ) : (
                  <video src={currentStory.media_url} className="story-media" controls autoPlay muted playsInline onError={() => void handleStoryMediaError(currentStory)} />
                )}
              </div>

              <div className="story-controls">
                <button type="button" className="story-hitbox story-hitbox-left" onClick={() => onStoryAdvance("prev")} aria-label="Previous story" />
                <button type="button" className="story-hitbox story-hitbox-right" onClick={() => onStoryAdvance("next")} aria-label="Next story" />
              </div>

              <div className="story-footer px-4 pb-6 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold" onClick={() => setReportOpen(true)}>Report</button>
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10" onClick={() => {}} aria-label="Pause story">
                    <Pause className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-sm leading-6 text-white/90">{currentStory.caption}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </main>
  );
}

function PlaceholderScreen({ activeTab, onChange }: { activeTab: string; onChange: (label: string) => void }) {
  const icons = { Chat: MessageCircle, Network, Calendar: CalendarDays, Profile: UserRound };
  const Icon = icons[activeTab as keyof typeof icons] ?? Home;
  return (
    <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]">
      <div className="placeholder-screen mx-auto max-w-[720px]">
        <header className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">CampusGlass</p>
            <h1 className="text-2xl font-bold">{activeTab}</h1>
          </div>
        </header>
        <GlassCard className="mt-8 p-6">
          <h2 className="text-lg font-bold">{activeTab} is coming next</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">This space is ready for the next phase of CampusGlass.</p>
        </GlassCard>
      </div>
      <BottomTabBar active={activeTab} onChange={onChange} />
    </main>
  );
}
