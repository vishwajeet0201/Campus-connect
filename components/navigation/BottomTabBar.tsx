"use client";

import { useSyncExternalStore } from "react";
import { CalendarDays, Home, MessageCircle, Network, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { GlassBar } from "@/components/glass";

const tabs = [
  { label: "Home", icon: Home },
  { label: "Chat", icon: MessageCircle },
  { label: "Network", icon: Network },
  { label: "Calendar", icon: CalendarDays },
  { label: "Profile", icon: UserRound },
];

export function BottomTabBar({ active = "Home", onChange, calendarBadge = 0 }: { active?: string; onChange?: (label: string) => void; calendarBadge?: number }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const router = useRouter();
  const routes: Record<string, string> = { Home: "/", Chat: "/chat", Network: "/network", Calendar: "/calendar", Profile: "/profile" };

  if (!mounted) return null;

  return createPortal(
    <GlassBar className="bottom-tab-bar z-30 flex items-center justify-between gap-1" role="navigation" aria-label="Primary navigation">
      {tabs.map(({ label, icon: Icon }) => {
        const isActive = label === active;
        return (
          <button className="tab-item relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1 text-[11px] font-semibold whitespace-nowrap" data-active={isActive} key={label} aria-label={label} onClick={() => { onChange?.(label); if (routes[label]) router.push(routes[label]); }}>
            {isActive && <motion.span layoutId="active-tab" className="tab-active absolute rounded-[14px]" transition={{ type: "spring", stiffness: 420, damping: 30 }} />}
            <span className="relative"><Icon className="relative z-10 h-6 w-6" strokeWidth={isActive ? 2.5 : 1.8} />{label === "Calendar" && calendarBadge > 0 && <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] text-white">{calendarBadge > 9 ? "9+" : calendarBadge}</span>}</span>
            <span className="relative z-10">{label}</span>
          </button>
        );
      })}
    </GlassBar>,
    document.body,
  );
}