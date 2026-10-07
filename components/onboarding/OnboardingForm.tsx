"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton, GlassCard, GlassInput } from "@/components/glass";
import { createClient } from "@/lib/supabase/browser";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";

type Department = { id: string; code: string; name: string };
type Degree = OnboardingValues["degree"];

const yearOptions: Record<Degree, number[]> = { diploma: [1, 2, 3], btech: [1, 2, 3, 4], mtech: [1, 2] };

export function OnboardingForm({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({ fullName: "", username: "", departmentId: "", degree: "btech" as Degree, year: "1", rollNumber: "", bio: "", avatarUrl: "" });
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const username = values.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return;

    const timer = window.setTimeout(async () => {
      setUsernameState("checking");
      const { data, error: availabilityError } = await supabase.rpc("is_username_available", { candidate: username });
      if (!availabilityError) setUsernameState(data ? "available" : "taken");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [supabase, values.username]);

  function updateValue<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeDegree(degree: Degree) {
    updateValue("degree", degree);
    updateValue("year", "1");
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setError("Choose an image smaller than 2MB.");
      return;
    }
    setError("");
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function nextStep() {
    setError("");
    if (step === 1 && (!values.fullName.trim() || usernameState === "taken" || usernameState === "checking")) {
      setError(usernameState === "taken" ? "That username is already in use." : "Enter your name and an available username.");
      return;
    }
    if (step === 2 && (!values.departmentId || !values.degree || !values.year)) {
      setError("Choose your department, degree, and year.");
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  }

  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = onboardingSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details.");
      return;
    }

    setPending(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    let avatarPath = "";
    if (avatarFile) {
      const extension = avatarFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, avatarFile, { contentType: avatarFile.type, upsert: true });
      if (uploadError) {
        setPending(false);
        setError(uploadError.message);
        return;
      }
      avatarPath = path;
    }

    const { error: updateError } = await supabase.from("profiles").update({ full_name: parsed.data.fullName, username: parsed.data.username, department_id: parsed.data.departmentId, degree: parsed.data.degree, year: parsed.data.year, roll_number: parsed.data.rollNumber || null, bio: parsed.data.bio || null, avatar_url: avatarPath || null, onboarded: true }).eq("id", user.id);
    setPending(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return <GlassCard className="p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI / CampusGlass</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">Set up your profile</h1></div><span className="text-sm font-semibold text-[var(--color-muted)]">{step} / 3</span></div><div className="mt-6 h-1 overflow-hidden rounded-full bg-[var(--color-separator)]"><span className="block h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${(step / 3) * 100}%` }} /></div><form className="mt-8" onSubmit={finish}>{step === 1 && <section><h2 className="text-xl font-bold">First, the basics</h2><p className="mt-2 text-sm text-[var(--color-muted)]">This is how classmates will find you.</p><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Full name<GlassInput className="mt-2 px-4 py-3" value={values.fullName} onChange={(event) => updateValue("fullName", event.target.value)} autoComplete="name" /></label><label className="block text-sm font-semibold">Username<GlassInput className="mt-2 px-4 py-3" value={values.username} onChange={(event) => { updateValue("username", event.target.value.toLowerCase()); setUsernameState("idle"); }} placeholder="your_handle" />{usernameState === "checking" && <span className="mt-1 block text-xs text-[var(--color-muted)]">Checking availability...</span>}{usernameState === "available" && <span className="mt-1 block text-xs font-semibold text-[var(--color-green)]">Username available</span>}{usernameState === "taken" && <span className="mt-1 block text-xs font-semibold text-[var(--color-red)]">Username already taken</span>}</label></div></section>}{step === 2 && <section><h2 className="text-xl font-bold">Your VJTI course</h2><p className="mt-2 text-sm text-[var(--color-muted)]">This helps personalize your campus network.</p><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Department<select className="glass-input mt-2 px-4 py-3" value={values.departmentId} onChange={(event) => updateValue("departmentId", event.target.value)}><option value="">Choose department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.code} - {department.name}</option>)}</select></label><fieldset><legend className="text-sm font-semibold">Degree</legend><div className="mt-2 grid grid-cols-3 gap-2">{(["diploma", "btech", "mtech"] as Degree[]).map((degree) => <GlassButton type="button" key={degree} className="px-2 py-3 text-xs font-semibold capitalize" data-variant={values.degree === degree ? "primary" : "default"} onClick={() => changeDegree(degree)}>{degree}</GlassButton>)}</div></fieldset><label className="block text-sm font-semibold">Year<select className="glass-input mt-2 px-4 py-3" value={values.year} onChange={(event) => updateValue("year", event.target.value)}>{yearOptions[values.degree].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label></div></section>}{step === 3 && <section><h2 className="text-xl font-bold">Make it yours</h2><p className="mt-2 text-sm text-[var(--color-muted)]">Everything here can be changed later.</p><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Avatar<span className="mt-2 flex items-center gap-4"><span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-avatar)] text-xl font-bold text-[var(--color-on-primary)]">{avatarPreview ? <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" /> : values.fullName.slice(0, 1).toUpperCase() || "?"}</span><span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" id="avatar" onChange={(event) => chooseAvatar(event.target.files?.[0])} /><label className="glass-button inline-block px-4 py-2 text-sm font-semibold" htmlFor="avatar">Choose image</label><span className="mt-1 block text-xs text-[var(--color-muted)]">JPG, PNG, WEBP or GIF, max 2MB</span></span></span></label><label className="block text-sm font-semibold">Roll number <span className="font-normal text-[var(--color-muted)]">(optional)</span><GlassInput className="mt-2 px-4 py-3" value={values.rollNumber} onChange={(event) => updateValue("rollNumber", event.target.value)} /></label><label className="block text-sm font-semibold">Short bio <span className="font-normal text-[var(--color-muted)]">(optional)</span><textarea className="glass-input mt-2 min-h-24 resize-y px-4 py-3" maxLength={160} value={values.bio} onChange={(event) => updateValue("bio", event.target.value)} /></label></div></section>}{error && <p className="mt-5 text-sm font-medium text-[var(--color-red)]" role="alert">{error}</p>}<div className="mt-8 flex gap-3">{step > 1 && <GlassButton type="button" className="px-5 py-3 text-sm font-semibold" onClick={() => setStep((current) => current - 1)}>Back</GlassButton>}{step < 3 ? <GlassButton type="button" variant="primary" className="ml-auto px-5 py-3 text-sm font-semibold" onClick={nextStep}>Continue</GlassButton> : <GlassButton type="submit" variant="primary" className="ml-auto px-5 py-3 text-sm font-semibold" disabled={pending}>{pending ? "Saving..." : "Finish profile"}</GlassButton>}</div></form></GlassCard>;
}