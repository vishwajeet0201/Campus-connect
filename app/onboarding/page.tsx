import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: departments } = await supabase.from("departments").select("id, code, name").order("name");
  return <main className="app-background min-h-screen px-4 py-8 text-[var(--color-ink)]"><div className="mx-auto w-full max-w-2xl"><OnboardingForm departments={departments ?? []} /></div></main>;
}