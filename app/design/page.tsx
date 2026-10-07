import { Bell, Check, Search, Sparkles } from "lucide-react";
import { GlassBar, GlassButton, GlassCard, GlassInput, GlassSheet } from "@/components/glass";
import { BottomTabBar } from "@/components/navigation/BottomTabBar";

const designStories = [
  { label: "Your story", initial: "+", seen: true, tone: "blue" },
  { label: "Aarav", initial: "A", seen: false, tone: "violet" },
  { label: "Meera", initial: "M", seen: true, tone: "warm" },
  { label: "Robotics", initial: "R", seen: false, tone: "pink" },
];

function PrimitiveSet() {
  return <>
    <section className="grid gap-5 md:grid-cols-2">
      <GlassCard className="p-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Card</p><h2 className="mt-4 text-2xl font-bold">Quiet surfaces, clear focus.</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Used for map details, profile sections, announcements, and grouped content.</p></GlassCard>
      <GlassSheet className="p-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Sheet</p><div className="mt-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-primary)] text-[var(--color-on-primary)]"><Sparkles className="h-5 w-5" /></span><div><h2 className="font-bold">A focused moment</h2><p className="text-sm text-[var(--color-muted)]">For detail views and actions.</p></div></div></GlassSheet>
    </section>
    <GlassBar className="search-bar flex flex-col gap-4 p-4 sm:flex-row sm:items-center"><div className="flex flex-1 items-center gap-3"><Search className="h-5 w-5 text-[var(--color-muted)]" /><GlassInput className="p-0" placeholder="Search the component library" /></div><div className="flex gap-2"><GlassButton className="px-4 py-2 text-sm font-semibold">Cancel</GlassButton><GlassButton variant="primary" className="flex items-center gap-2 px-4 py-2 text-sm font-semibold"><Check className="h-4 w-4" /> Confirm</GlassButton></div></GlassBar>
    <GlassCard className="p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Controls</p><h2 className="mt-2 text-xl font-bold">Status and utility</h2></div><GlassButton className="grid h-10 w-10 place-items-center" aria-label="Notifications"><Bell className="h-4 w-4" /></GlassButton></div><div className="mt-5 flex flex-wrap gap-3"><GlassButton className="px-4 py-2 text-sm font-semibold">Default</GlassButton><GlassButton variant="primary" className="px-4 py-2 text-sm font-semibold">Primary action</GlassButton><span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-2 text-xs font-bold text-[var(--color-accent)]">Verified student</span></div></GlassCard>
  </>;
}

export default function DesignPage() {
  return (
    <main className="app-background app-shell min-h-screen px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-8">
        <header><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent)]">CampusGlass / Design system</p><h1 className="mt-2 text-4xl font-bold tracking-[-0.04em]">Surface tiers</h1><p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted)]">Flat content stays calm. Material sheets sit above the map. Glass is reserved for floating controls.</p></header>
        <section aria-labelledby="surface-tiers" className="grid gap-4 md:grid-cols-3">
          <div className="surface-flat rounded-[var(--radius-card)] border border-[var(--color-separator)] p-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Flat</p><h2 id="surface-tiers" className="mt-2 text-xl font-bold">Content surfaces</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Lists, cards, forms, login and onboarding. Solid system background, no blur.</p><p className="mt-4 text-xs font-semibold text-[var(--color-accent)]">Do: readable grouped content</p><p className="mt-1 text-xs text-[var(--color-muted)]">Don&apos;t: add translucency to every card</p></div>
          <div className="surface-material rounded-[var(--radius-card)] p-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Material</p><h2 className="mt-2 text-xl font-bold">Map-adjacent sheets</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Opaque-enough POI sheets and popovers over changing map content.</p><p className="mt-4 text-xs font-semibold text-[var(--color-accent)]">Do: keep text AA-readable</p><p className="mt-1 text-xs text-[var(--color-muted)]">Don&apos;t: nest it inside glass</p></div>
          <div className="surface-glass rounded-[var(--radius-card)] p-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Glass</p><h2 className="mt-2 text-xl font-bold">Floating controls</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Search, navigation, floor selection and tab controls only.</p><p className="mt-4 text-xs font-semibold text-[var(--color-accent)]">Do: use one or two layers</p><p className="mt-1 text-xs text-[var(--color-muted)]">Don&apos;t: put content cards inside it</p></div>
        </section>
        <section aria-label="Stories preview" className="flex gap-4 overflow-x-auto pb-1">{designStories.map((story) => <div className="flex min-w-[62px] flex-col items-center gap-2" key={story.label}><span className="story-ring relative grid h-14 w-14 place-items-center rounded-full p-[2px]" data-seen={story.seen}><span className="story-avatar grid h-full w-full place-items-center rounded-full text-sm font-bold" data-tone={story.tone}>{story.initial}</span>{story.label === "Your story" && <span className="story-add-badge absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--surface-primary)] text-xs font-bold text-[var(--color-on-primary)]">+</span>}</span><span className="max-w-16 truncate text-[11px] font-medium text-[var(--color-muted)]">{story.label}</span></div>)}</section>
        <section data-theme="dark" className="theme-panel relative flex flex-col gap-6 overflow-hidden rounded-[var(--radius-card)] p-5"><div className="relative z-10"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Dark theme</p><h2 className="mt-2 text-2xl font-bold">Midnight glass</h2></div><div className="relative z-10"><PrimitiveSet /></div></section>
        <section><p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Light theme</p><PrimitiveSet /></section>
      </div>
      <BottomTabBar />
    </main>
  );
}