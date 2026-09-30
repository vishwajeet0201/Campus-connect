"use client";

import { Bell, CalendarDays, Home, MessageCircle, Navigation, Network, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { GlassBar, GlassButton, GlassCard, GlassInput } from "@/components/glass";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";

const stories = [
  { label: "Your story", initial: "+", seen: true, tone: "blue" },
  { label: "Aarav", initial: "A", seen: false, tone: "violet" },
  { label: "Meera", initial: "M", seen: true, tone: "warm" },
  { label: "Robotics", initial: "R", seen: false, tone: "pink" },
  { label: "VJTI Music", initial: "V", seen: false, tone: "blue" },
];

export function AppShell() {
  const [activeTab, setActiveTab] = useState("Home");

  if (activeTab !== "Home") {
    return <PlaceholderScreen activeTab={activeTab} onChange={setActiveTab} />;
  }

  return (
    <main className="app-background home-shell relative min-h-screen text-[var(--color-ink)]">
      <div className="home-map-layer" aria-label="Campus map preview"><div className="home-map-grid"><span className="map-pin left-[28%] top-[34%]" /><span className="map-pin map-pin--orange right-[26%] top-[48%]" /><span className="map-pin map-pin--green bottom-[28%] left-[44%]" /></div></div>
      <div className="home-top-overlay">
        <div className="home-top-inner flex flex-col gap-2">
          <header className="flex items-center justify-between gap-3 px-1">
            <div className="home-heading"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI / CampusGlass</p><h1 className="text-lg font-bold tracking-[-0.02em]">Good morning, student.</h1></div>
            <GlassButton className="grid h-10 w-10 shrink-0 place-items-center" aria-label="Notifications"><Bell className="h-5 w-5" /></GlassButton>
          </header>
          <GlassBar className="search-bar home-search flex items-center gap-3 px-4 py-2"><Search className="h-5 w-5 shrink-0 text-[var(--color-ink)] opacity-65" /><GlassInput className="border-0 bg-transparent p-0 shadow-none focus:bg-transparent" placeholder="Search campus" aria-label="Search campus" /><GlassButton className="grid h-8 w-8 shrink-0 place-items-center" aria-label="Open filters"><SlidersHorizontal className="h-4 w-4" /></GlassButton></GlassBar>
          <section aria-label="Stories" className="home-stories flex gap-3 overflow-x-auto px-1 pb-1">{stories.map((story) => <motion.button whileTap={{ scale: 0.94 }} key={story.label} className="flex min-w-[68px] flex-col items-center gap-1" aria-label={story.label}><span className="story-ring relative grid h-16 w-16 place-items-center rounded-full p-[2px]" data-seen={story.seen}><span className="story-avatar grid h-full w-full place-items-center rounded-full text-sm font-bold" data-tone={story.tone}>{story.initial}</span>{story.label === "Your story" && <span className="story-add-badge absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--surface-primary)] text-xs font-bold text-[var(--color-on-primary)]">+</span>}</span><span className="max-w-16 truncate text-[11px] font-medium text-[var(--color-ink)] opacity-75">{story.label}</span></motion.button>)}</section>
        </div>
      </div>
      <div className="map-tools"><GlassBar className="floor-pill">{["G", "1", "2", "3"].map((floor, index) => <button key={floor} data-active={index === 0}>{floor}</button>)}</GlassBar><GlassButton className="directions-button" aria-label="Directions"><Navigation className="h-5 w-5 text-[var(--color-accent)]" /></GlassButton></div>
      <BottomTabBar active={activeTab} onChange={setActiveTab} />
    </main>
  );
}

function PlaceholderScreen({ activeTab, onChange }: { activeTab: string; onChange: (label: string) => void }) {
  const icons = { Chat: MessageCircle, Network, Calendar: CalendarDays, Profile: UserRound };
  const Icon = icons[activeTab as keyof typeof icons] ?? Home;
  return <main className="app-background scroll-shell min-h-screen text-[var(--color-ink)]"><div className="placeholder-screen mx-auto max-w-[720px]"><header className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"><Icon className="h-6 w-6" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">CampusGlass</p><h1 className="text-2xl font-bold">{activeTab}</h1></div></header><GlassCard className="mt-8 p-6"><h2 className="text-lg font-bold">{activeTab} is coming next</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">This space is ready for the next phase of CampusGlass.</p></GlassCard></div><BottomTabBar active={activeTab} onChange={onChange} /></main>;
}