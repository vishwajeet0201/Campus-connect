"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { NAV_PLACES, planRoute, type NavRoute } from "@/lib/navigation";

/** Tap-driven directions on the ground-floor plan (the voice guide's sibling). */
export function DirectionsPanel({
  fromId,
  toId,
  onChange,
  onRouteChange,
  onClose,
}: {
  fromId: string;
  toId: string;
  onChange: (fromId: string, toId: string) => void;
  onRouteChange: (route: NavRoute | null, step: number) => void;
  onClose: () => void;
}) {
  const from = NAV_PLACES.find((p) => p.id === fromId) ?? null;
  const to = NAV_PLACES.find((p) => p.id === toId) ?? null;
  const route = useMemo(() => (from && to && from.id !== to.id ? planRoute(from, to) : null), [from, to]);
  const [step, setStep] = useState({ key: "", index: 0 });
  const routeKey = `${fromId}>${toId}`;
  // A new journey starts at its overview.
  const index = step.key === routeKey ? step.index : 0;
  const options = useMemo(() => [...NAV_PLACES].sort((a, b) => a.label.localeCompare(b.label)), []);

  useEffect(() => {
    onRouteChange(route, index);
  }, [index, onRouteChange, route]);

  useEffect(() => () => onRouteChange(null, 0), [onRouteChange]);

  const steps = route?.steps ?? [];
  const go = (next: number) => setStep({ key: routeKey, index: Math.max(0, Math.min(next, steps.length - 1)) });
  const resolvedTo = route && route.to.id !== toId ? route.to : null;

  return <motion.section initial={{ y: 140, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 140, opacity: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }} className="voice-assistant-container" aria-label="Directions">
    <div className="voice-assistant surface-material">
      <header className="flex items-start justify-between gap-3">
        <div className="directions-fields min-w-0 flex-1">
          <label className="directions-field"><span>From</span>
            <select value={fromId} onChange={(event) => onChange(event.target.value, toId)}>
              {options.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="directions-field"><span>To</span>
            <select value={toId} onChange={(event) => onChange(fromId, event.target.value)}>
              {options.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button type="button" className="voice-icon-button" aria-label="Close directions" onClick={onClose}><X className="h-4 w-4" /></button>
          <button type="button" className="voice-icon-button" aria-label="Swap start and destination" onClick={() => onChange(toId, fromId)}><ArrowUpDown className="h-4 w-4" /></button>
        </div>
      </header>

      {fromId === toId && <p className="voice-prompt" role="status">Choose two different places.</p>}
      {from && to && fromId !== toId && !route && <p className="voice-error" role="alert">No walking route was found between these places.</p>}
      {resolvedTo && <p className="voice-transcript">Showing the nearest one: {resolvedTo.label}.</p>}

      {route && <ol className="voice-steps" aria-label="Steps">
        {steps.map((s, i) => <li key={`${s.start}-${i}`} data-active={i === index} data-done={i < index}><button type="button" onClick={() => go(i)}>{s.text}</button></li>)}
      </ol>}

      {route && <div className="voice-controls">
        <GlassButton type="button" className="voice-nav-button" aria-label="Previous step" onClick={() => go(index - 1)} disabled={index <= 0}><ChevronLeft className="h-5 w-5" /></GlassButton>
        <p className="directions-progress" aria-live="polite">Step {index + 1} of {steps.length}</p>
        <GlassButton type="button" className="voice-nav-button" aria-label="Next step" onClick={() => go(index + 1)} disabled={index >= steps.length - 1}><ChevronRight className="h-5 w-5" /></GlassButton>
      </div>}
    </div>
  </motion.section>;
}
