"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CalendarDays, ChevronRight, Clock3, Home, MessageCircle, Navigation, Network, Pause, Search, SlidersHorizontal, Trash2, Upload, UserRound, Verified, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { GlassBar, GlassButton, GlassCard, GlassInput } from "@/components/glass";
import { CampusMapViewer, type MapFloor, type MapPoi } from "@/components/map/CampusMapViewer";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";
import { VoiceAssistant } from "@/components/navigation/VoiceAssistant";
import { DirectionsPanel } from "@/components/navigation/DirectionsPanel";
import { CATEGORY_LABELS, NAV_PLACES, searchPlaces, type NavPlace, type NavRoute } from "@/lib/navigation";
import { imageFor, planFor, VJTI_GROUND } from "@/lib/maps";
import { extractStoryMediaPath, formatPoiLocation, getStoryErrorMessage, isStoryExpired, rankPoiSearch, type StoryItem } from "@/lib/campus";

const floors: MapFloor[] = [
  { id: "g", building_code: "VJTI", building_name: "VJTI main building", code: "G", name: "Ground Floor", sort_order: 0, svg_path: VJTI_GROUND.floor.image, width: VJTI_GROUND.floor.width, height: VJTI_GROUND.floor.height },
  { id: "1", building_code: "VJTI", building_name: "VJTI main building", code: "1", name: "First Floor", sort_order: 1, svg_path: "/maps/vjti-1.svg", width: 1600, height: 1000 },
  { id: "2", building_code: "VJTI", building_name: "VJTI main building", code: "2", name: "Second Floor", sort_order: 2, svg_path: "/maps/vjti-2.svg", width: 1600, height: 1000 },
  { id: "3", building_code: "VJTI", building_name: "VJTI main building", code: "3", name: "Third Floor", sort_order: 3, svg_path: "/maps/vjti-3.svg", width: 1600, height: 1000 },
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("Home");
  const [buildings, setBuildings] = useState<{ id: string; code: string; name: string; sort_order: number }[]>([
    { id: "vjti", code: "VJTI", name: "VJTI main building", sort_order: 0 },
    { id: "mech", code: "MECH", name: "Mechanical building", sort_order: 1 },
  ]);
  const [mapFloors, setMapFloors] = useState<MapFloor[]>(floors);
  const [mapPois, setMapPois] = useState<MapPoi[]>(poiSeed);
  const [activeBuildingCode, setActiveBuildingCode] = useState("VJTI");
  const [activeFloorId, setActiveFloorId] = useState(floors[0].id);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedPoi, setSelectedPoi] = useState<MapPoi | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [navRoute, setNavRoute] = useState<{ route: NavRoute; step: number } | null>(null);
  const handleRouteChange = useCallback((route: NavRoute | null, step: number) => setNavRoute(route ? { route, step } : null), []);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [directions, setDirections] = useState<{ fromId: string; toId: string } | null>(null);
  const [chipsBottom, setChipsBottom] = useState(280);
  // Publishes the filter row's bottom edge as --home-chips-bottom (and to the map's insets) so the map is framed below it.
  const filterRowRef = useCallback((row: HTMLDivElement | null) => {
    const shell = row?.closest<HTMLElement>(".home-shell");
    if (!row || !shell) return;
    const update = () => {
      const bottom = row.getBoundingClientRect().bottom - shell.getBoundingClientRect().top;
      shell.style.setProperty("--home-chips-bottom", `${bottom}px`);
      setChipsBottom(bottom);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    observer.observe(shell);
    const stories = shell.querySelector(".story-strip-wrap");
    if (stories) observer.observe(stories);
    return () => observer.disconnect();
  }, []);
  // Height of whichever bottom panel is open (sheet, directions or voice guide), measured by
  // layout position so the slide-in animation doesn't skew it; the map frames itself above it.
  const [bottomPanel, setBottomPanel] = useState(0);
  const shellRef = useCallback((shell: HTMLElement | null) => {
    if (!shell) return;
    const selector = ".poi-sheet-container, .voice-assistant-container";
    const sizes = new ResizeObserver(() => measure());
    const watched = new Set<Element>();
    function measure() {
      let top = Infinity;
      shell!.querySelectorAll<HTMLElement>(selector).forEach((panel) => {
        if (!watched.has(panel)) { watched.add(panel); sizes.observe(panel); }
        if (panel.offsetHeight > 0) top = Math.min(top, panel.offsetTop);
      });
      setBottomPanel(Number.isFinite(top) ? Math.max(0, shell!.clientHeight - top) : 0);
    }
    const mutations = new MutationObserver(measure);
    mutations.observe(shell, { childList: true, subtree: true });
    measure();
    return () => { mutations.disconnect(); sizes.disconnect(); };
  }, []);
  const [storyIndex, setStoryIndex] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [storyFailures, setStoryFailures] = useState<Record<string, boolean>>({});
  const [removingStory, setRemovingStory] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [storyError, setStoryError] = useState("");
  const [storyDraft, setStoryDraft] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const timerRef = useRef<number | null>(null);
  const refreshAttemptsRef = useRef<Record<string, number>>({});
  const supabase = useMemo(() => createClient(), []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const activeBuildingFloors = mapFloors.filter((floor) => floor.building_code === activeBuildingCode).sort((a, b) => a.sort_order - b.sort_order);
  const placeResults = useMemo(() => searchPlaces(query), [query]);
  // Seeded POIs only stand in for floors that don't have a real plan or image yet.
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const placeholderFloors = new Set(mapFloors.filter((floor) => !planFor(floor.building_code, floor.code) && !imageFor(floor.building_code, floor.code)).map((floor) => floor.id));
    return rankPoiSearch(query, mapPois.filter((poi) => placeholderFloors.has(poi.floor_id))).slice(0, 5);
  }, [mapFloors, mapPois, query]);
  const selectedPlace = useMemo<NavPlace | null>(() => NAV_PLACES.find((place) => place.id === selectedFeatureId) ?? null, [selectedFeatureId]);
  const activeFloor = mapFloors.find((floor) => floor.id === activeFloorId);
  const guiding = Boolean(directions) || assistantOpen;
  const mapInsets = useMemo(() => ({ top: chipsBottom + 8, right: guiding ? 12 : 72, bottom: Math.max(bottomPanel, 96) + 12, left: 64 }), [bottomPanel, chipsBottom, guiding]);

  const activeStories = useMemo(() => stories.filter((story) => !isStoryExpired(story)), [stories]);
  const currentStory = storyIndex == null ? null : activeStories[storyIndex] ?? null;
  const storyGroups = useMemo(() => {
    const groups = new Map<string, StoryItem>();
    for (const story of activeStories) {
      if (!groups.has(story.author_id)) groups.set(story.author_id, story);
    }
    return [...groups.values()];
  }, [activeStories]);

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
    void supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    async function loadMapData() {
      const [{ data: buildingRows }, { data: floorRows }, { data: poiRows }] = await Promise.all([
        supabase.from("buildings").select("id,code,name,sort_order").order("sort_order"),
        supabase.from("floors").select("id,building_id,code,name,sort_order,svg_path,width,height,building:buildings(code,name)").order("sort_order"),
        supabase.from("pois").select("id,floor_id,building_id,category_id,name,description,room_code,x,y,opening_hours,is_accessible,category:poi_categories(code),floor:floors(code,building:buildings(code,name))"),
      ]);
      if (cancelled) return;
      if (buildingRows?.length) setBuildings(buildingRows as typeof buildings);
      if (floorRows?.length) {
        const nextFloors = floorRows.map((row) => {
          const building = Array.isArray(row.building) ? row.building[0] : row.building;
          const isVjtiGroundFloor = building?.code === "VJTI" && row.code === "G";
          return {
            ...row,
            building_code: building?.code,
            building_name: building?.name,
            ...(isVjtiGroundFloor ? {
              svg_path: VJTI_GROUND.floor.image,
              width: VJTI_GROUND.floor.width,
              height: VJTI_GROUND.floor.height,
            } : {}),
          } as MapFloor;
        });
        setMapFloors(nextFloors);
        const storedBuilding = window.localStorage.getItem("campus-building");
        const initialBuilding = (buildingRows?.find((building) => building.code === storedBuilding) ?? buildingRows?.[0]) as { code: string } | undefined;
        const initialFloor = nextFloors.find((floor) => floor.building_code === initialBuilding?.code && floor.code === "G") ?? nextFloors[0];
        if (initialBuilding) setActiveBuildingCode(initialBuilding.code);
        if (initialFloor) setActiveFloorId(initialFloor.id);
      }
      if (poiRows?.length) {
        setMapPois(poiRows.map((row) => {
          const floor = Array.isArray(row.floor) ? row.floor[0] : row.floor;
          const building = floor && (Array.isArray(floor.building) ? floor.building[0] : floor.building);
          const category = Array.isArray(row.category) ? row.category[0] : row.category;
          return { ...row, x: Number(row.x), y: Number(row.y), category: category?.code, floor_code: floor?.code, building_code: building?.code, building_name: building?.name } as MapPoi;
        }));
      }
    }
    void loadMapData();
    return () => { cancelled = true; };
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
      const authorIds = [...new Set((data ?? []).map((row) => row.author_id))];
      const { data: profiles, error: profileError } = authorIds.length
        ? await supabase.from("profiles").select("id,full_name,username,role").in("id", authorIds)
        : { data: [], error: null };
      if (profileError) {
        if (process.env.NODE_ENV === "development") console.warn("Could not load story authors:", profileError.message);
      }
      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const rows = (data ?? []).map((row) => {
        const profile = profileById.get(row.author_id);
        const author = profile?.full_name?.trim() || profile?.username?.trim() || "Student";
        return {
        ...row,
        author,
        media_path: row.media_path ?? extractStoryMediaPath(row.media_url),
        seen: false,
        verified: row.kind !== "student" || profile?.role === "committee" || profile?.role === "admin",
        };
      }) as StoryItem[];
      const signedStories = await signStories(rows);
      if (!cancelled) setStories(signedStories);
    }
    void loadStories();
    return () => { cancelled = true; };
  }, [signStories, supabase]);

  const openStory = (index: number) => {
    if (activeStories[index]) {
      setStoryIndex(index);
      void supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) void supabase.from("story_views").upsert({ story_id: activeStories[index].id, viewer_id: user.id }, { onConflict: "story_id,viewer_id" });
      });
    }
  };

  const closeStory = () => setStoryIndex(null);

  const showGroundFloor = () => {
    setActiveBuildingCode("VJTI");
    const groundFloor = mapFloors.find((floor) => floor.building_code === "VJTI" && floor.code === "G");
    if (groundFloor) setActiveFloorId(groundFloor.id);
  };

  const selectPlace = (id: string | null, focus = false) => {
    setSelectedPoi(null);
    setSelectedFeatureId(id);
    if (id && focus) setFocusRequest((previous) => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
  };

  const handlePlaceSelect = (place: NavPlace) => {
    setQuery("");
    showGroundFloor();
    selectPlace(place.id, true);
  };

  const openDirections = (toId: string) => {
    setAssistantOpen(false);
    showGroundFloor();
    setDirections({ fromId: toId === "main-gate" ? "mechanical-gate" : "main-gate", toId });
  };

  const handleSearchSelect = (poi: MapPoi) => {
    setQuery("");
    setActiveBuildingCode(poi.building_code ?? "VJTI");
    setActiveFloorId(poi.floor_id);
    setSelectedPoi(poi);
  };

  const switchBuilding = (code: string) => {
    const nextFloor = mapFloors.filter((floor) => floor.building_code === code).sort((a, b) => a.sort_order - b.sort_order).find((floor) => floor.code === "G");
    setActiveBuildingCode(code);
    window.localStorage.setItem("campus-building", code);
    if (nextFloor) setActiveFloorId(nextFloor.id);
    setSelectedPoi(null);
    setSelectedFeatureId(null);
  };

  // The voice guide routes over the VJTI ground-floor graph, so show that floor while it's open.
  const openAssistant = () => {
    if (assistantOpen) {
      setAssistantOpen(false);
      setNavRoute(null);
      return;
    }
    if (activeBuildingCode !== "VJTI") switchBuilding("VJTI");
    showGroundFloor();
    setSelectedPoi(null);
    setSelectedFeatureId(null);
    setDirections(null);
    setAssistantOpen(true);
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
    setStoryError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStoryError("Sign in before posting a story.");
      return;
    }
    const extension = storyDraft.type === "video" ? "mp4" : "jpg";
    const mediaPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    let file: Blob;
    try {
      file = await (await fetch(storyDraft.url)).blob();
    } catch {
      setStoryError("We couldn't read that file. Choose it again and retry.");
      return;
    }
    const { error: uploadError } = await supabase.storage.from("stories").upload(mediaPath, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setStoryError(getStoryErrorMessage(uploadError));
      return;
    }
    const { data, error } = await supabase.from("stories").insert({
      author_id: user.id,
      kind: "student",
      media_path: mediaPath,
      media_url: null,
      media_type: storyDraft.type,
      caption: caption || null,
    }).select("id,author_id,kind,media_url,media_path,media_type,caption,created_at,expires_at").single();
    if (error || !data) {
      await supabase.storage.from("stories").remove([mediaPath]);
      setStoryError(getStoryErrorMessage(error));
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("full_name,username,role").eq("id", user.id).maybeSingle();
    const author = profile?.full_name?.trim() || profile?.username?.trim() || "You";
    const newStory = { ...data, author, seen: false, verified: profile?.role === "committee" || profile?.role === "admin" } as StoryItem;
    const [signedStory] = await signStories([newStory]);
    setStories((current) => [signedStory ?? newStory, ...current]);
    setComposerOpen(false);
    setStoryError("");
    setCaption("");
    URL.revokeObjectURL(storyDraft.url);
    setStoryDraft(null);
    setStoryIndex(0);
  };

  const deleteCurrentStory = async () => {
    if (!currentStory || removingStory) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== currentStory.author_id) {
      setStoryError("You can only remove your own stories.");
      return;
    }
    setStoryError("");
    setRemovingStory(true);
    const { data: deletedStory, error } = await supabase
      .from("stories")
      .delete()
      .eq("id", currentStory.id)
      .eq("author_id", user.id)
      .select("id")
      .maybeSingle();
    if (error || !deletedStory) {
      setStoryError(error ? getStoryErrorMessage(error) : "We couldn't remove this story. It may have expired or you may not have permission.");
      setRemovingStory(false);
      return;
    }
    if (currentStory.media_path) {
      const { error: mediaError } = await supabase.storage.from("stories").remove([currentStory.media_path]);
      if (mediaError && process.env.NODE_ENV === "development") console.warn("Story was removed, but its media cleanup failed:", mediaError.message);
    }
    setStories((current) => current.filter((story) => story.id !== currentStory.id));
    setStoryIndex(null);
    setStoryError("");
    setRemovingStory(false);
  };

  const reportCurrentStory = async () => {
    if (!currentStory) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      target_type: "story",
      target_id: currentStory.id,
      reason: "Story reported by viewer",
    });
    if (error && process.env.NODE_ENV === "development") console.warn("Could not report story:", error.message);
    setReportOpen(false);
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

  if (activeTab === "Network" || activeTab === "Calendar" || activeTab === "Profile") {
    router.push(activeTab === "Network" ? "/network" : activeTab === "Calendar" ? "/calendar" : "/profile");
    return null;
  }
  if (activeTab !== "Home") {
    return <PlaceholderScreen activeTab={activeTab} onChange={setActiveTab} />;
  }

  return (
    <main ref={shellRef} className="app-background home-shell relative min-h-screen text-[var(--color-ink)]">
      <div className="home-map-layer" aria-label="Campus map preview">
        <CampusMapViewer floors={mapFloors} pois={mapPois} activeFloorId={activeFloorId} insets={mapInsets} selectedFeatureId={selectedFeatureId} onSelectFeature={(id) => { if (!directions && !assistantOpen) selectPlace(id); }} focusRequest={focusRequest} selectedPoiId={selectedPoi?.id ?? null} onSelectPoi={(poi) => { setSelectedFeatureId(null); setSelectedPoi(poi); }} onPanningChange={setIsPanning} categoryFilter={categoryFilter} route={activeFloor?.building_code === "VJTI" && activeFloor.code === "G" ? navRoute?.route : null} routeStep={navRoute?.step} />
      </div>

      <div className="home-top-overlay">
        <div className="home-top-inner flex flex-col gap-2">
          <header className="flex items-center justify-between gap-3 px-1">
            <div className="home-heading">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI / CampusConnect</p>
              <h1 className="text-lg font-bold tracking-[-0.02em]">Good morning, student.</h1>
            </div>
            <GlassButton surface="glass" className="grid h-10 w-10 shrink-0 place-items-center" aria-label="Notifications" onClick={() => router.push("/calendar?unread=1")}>
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
            {(placeResults.length > 0 || searchResults.length > 0) && (
              <GlassCard surface="material" className="search-dropdown absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden p-1">
                {placeResults.map((place) => (
                  <button key={place.id} className="search-result flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm hover:bg-white/8" onClick={() => handlePlaceSelect(place)}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{place.label}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{CATEGORY_LABELS[place.category] ?? place.category} · VJTI main building, Ground Floor</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--color-muted)]" />
                  </button>
                ))}
                {searchResults.map(({ poi }) => (
                  <button key={poi.id} className="search-result flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm hover:bg-white/8" onClick={() => handleSearchSelect(poi)}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{poi.name}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{poi.room_code} · {formatPoiLocation(poi)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--color-muted)]" />
                  </button>
                ))}
              </GlassCard>
            )}
          </div>

          <div className="story-strip-wrap" data-collapsed={guiding || undefined}>
            <section aria-label="Stories" className="home-stories flex gap-3 overflow-x-auto px-1 pb-1" data-collapsed={isPanning}>
              <motion.button whileTap={{ scale: 0.94 }} className="flex min-w-[68px] flex-col items-center gap-1" aria-label="Create your story" onClick={() => setComposerOpen(true)}>
                <span className="story-ring relative grid h-16 w-16 place-items-center rounded-full p-[2px]" data-seen={true}>
                  <span className="story-avatar grid h-full w-full place-items-center rounded-full text-sm font-bold">+</span>
                </span>
                <span className="max-w-16 truncate text-[11px] font-medium text-[var(--color-ink)] opacity-75">Your story</span>
              </motion.button>

              {storyGroups.map((story) => {
                const seen = story.seen ?? false;
                const index = activeStories.findIndex((candidate) => candidate.author_id === story.author_id);
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

          <div ref={filterRowRef} className="category-filter-row flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => (
              <button key={option.value} type="button" className={`filter-chip ${categoryFilter === option.value ? "is-active" : ""}`} onClick={() => setCategoryFilter(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="map-tools" hidden={guiding}>
        <GlassBar className="building-pill">
          {buildings.map((building) => (
            <button key={building.code} type="button" data-active={building.code === activeBuildingCode} onClick={() => switchBuilding(building.code)}>
              {building.code === "MECH" ? "Mech" : "VJTI"}
            </button>
          ))}
        </GlassBar>
        <GlassBar className="floor-pill">
          {activeBuildingFloors.map((floor) => (
            <button key={floor.id} type="button" data-active={floor.id === activeFloorId} onClick={() => setActiveFloorId(floor.id)}>
              {floor.code}
            </button>
          ))}
        </GlassBar>
        <GlassButton surface="glass" className="directions-button" aria-label="Voice directions" aria-pressed={assistantOpen} onClick={openAssistant}>
          <Navigation className="h-5 w-5 text-[var(--color-accent)]" />
        </GlassButton>
      </div>

      <AnimatePresence>
        {assistantOpen && <VoiceAssistant key="voice-assistant" onRouteChange={handleRouteChange} onClose={() => setAssistantOpen(false)} />}
        {directions && !assistantOpen && <DirectionsPanel key="directions" fromId={directions.fromId} toId={directions.toId} onChange={(fromId, toId) => setDirections({ fromId, toId })} onRouteChange={handleRouteChange} onClose={() => setDirections(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPlace && !assistantOpen && !directions && (
          <motion.div initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }} className="poi-sheet-container">
            <motion.div drag="y" dragConstraints={{ top: 0, bottom: 0 }} onDragEnd={(_, info) => { if (info.offset.y > 80) setSelectedFeatureId(null); }} className="poi-bottom-sheet surface-material p-4">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--color-separator)]" />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI main building, Ground Floor · {CATEGORY_LABELS[selectedPlace.category] ?? selectedPlace.category}</p>
                  <h2 className="mt-1 text-xl font-bold">{selectedPlace.label}</h2>
                </div>
                <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-separator)]" aria-label="Close" onClick={() => setSelectedFeatureId(null)}><X className="h-4 w-4" /></button>
              </div>
              {(VJTI_GROUND.rooms.find((room) => room.id === selectedPlace.id) ?? VJTI_GROUND.places.find((place) => place.id === selectedPlace.id))?.inferredEntrances && <p className="mt-3 text-sm text-[var(--color-muted)]">The campus map doesn&apos;t mark an entrance here, so directions lead to its nearest side.</p>}
              <div className="mt-4 flex gap-2">
                <GlassButton className="flex-1" variant="primary" onClick={() => openDirections(selectedPlace.id)}>
                  <Navigation className="mr-1 inline h-4 w-4" /> Directions
                </GlassButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPoi && !assistantOpen && (
          <motion.div initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }} className="poi-sheet-container">
            <motion.div drag="y" dragConstraints={{ top: 0, bottom: 0 }} onDragEnd={(_, info) => { if (info.offset.y > 80) setSelectedPoi(null); }} className="poi-bottom-sheet surface-material p-4">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--color-separator)]" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">{formatPoiLocation(selectedPoi)} · {selectedPoi.category}</p>
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

      <BottomTabBar active={activeTab} onChange={(label) => label === "Chat" ? router.push("/chat") : setActiveTab(label)} />

      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {composerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="story-composer-backdrop" onClick={() => setComposerOpen(false)}>
            <motion.div initial={{ y: 32, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }} onClick={(event) => event.stopPropagation()} className="story-composer surface-flat p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold">Create story</h3>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10" onClick={() => setComposerOpen(false)} aria-label="Close composer"><X className="h-4 w-4" /></button>
              </div>

              {storyError && <p className="mb-3 rounded-xl bg-[var(--color-red)]/10 p-3 text-sm text-[var(--color-red)]" role="alert">{storyError}</p>}
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
              <div className="mt-5 flex justify-end gap-2"><GlassButton type="button" onClick={() => setReportOpen(false)}>Cancel</GlassButton><GlassButton type="button" variant="primary" onClick={() => void reportCurrentStory()}>Report</GlassButton></div>
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
                  <div className="flex items-center gap-2">
                    {currentUserId === currentStory.author_id && <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold disabled:opacity-60" disabled={removingStory} onClick={(event) => { event.stopPropagation(); void deleteCurrentStory(); }}><Trash2 className="mr-1 inline h-3 w-3" />{removingStory ? "Removing…" : "Remove"}</button>}
                    <button type="button" className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold" onClick={() => setReportOpen(true)}>Report</button>
                  </div>
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
  const router = useRouter();
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
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">CampusConnect</p>
            <h1 className="text-2xl font-bold">{activeTab}</h1>
          </div>
        </header>
        <GlassCard className="mt-8 p-6">
          <h2 className="text-lg font-bold">{activeTab} is coming next</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">This space is ready for the next phase of CampusConnect.</p>
        </GlassCard>
      </div>
      <BottomTabBar active={activeTab} onChange={(label) => label === "Home" ? router.push("/") : onChange(label)} />
    </main>
  );
}
