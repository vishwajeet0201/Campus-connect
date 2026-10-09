import { CalendarPage } from "@/components/calendar/CalendarPage";
import { Suspense } from "react";

export default function Page() {
  return <Suspense fallback={<main className="app-background min-h-screen" />}><CalendarPage /></Suspense>;
}
