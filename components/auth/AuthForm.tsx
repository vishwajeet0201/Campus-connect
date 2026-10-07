"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton, GlassCard, GlassInput } from "@/components/glass";
import { isCollegeEmail } from "@/config/college";
import { createClient } from "@/lib/supabase/browser";

type AuthMode = "login" | "signup";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!isCollegeEmail(email)) {
      setError("Use your VJTI college email address, such as name@cse.vjti.ac.in.");
      return;
    }

    setPending(true);
    const result = isSignup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    setPending(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (isSignup) {
      setMessage("Check your inbox to verify your email before continuing.");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  async function sendMagicLink() {
    setError("");
    setMessage("");
    if (!isCollegeEmail(email)) {
      setError("Use your VJTI college email address, such as name@cse.vjti.ac.in.");
      return;
    }

    setPending(true);
    const { error: magicError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setPending(false);
    if (magicError) setError(magicError.message);
    else setMagicLinkSent(true);
  }

  if (magicLinkSent) {
    return <GlassCard className="p-6"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">Magic link sent</p><h2 className="mt-3 text-2xl font-bold">Check your inbox</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Use the verification link sent to {email} to continue to CampusGlass.</p><GlassButton className="mt-6 w-full px-4 py-3 text-sm font-semibold" onClick={() => setMagicLinkSent(false)}>Use another email</GlassButton></GlassCard>;
  }

  return <GlassCard className="p-6"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">VJTI / CampusGlass</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">{isSignup ? "Create your campus account" : "Welcome back"}</h1><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{isSignup ? "Use your verified VJTI email to join the college network." : "Sign in with your verified VJTI account."}</p></div><form className="mt-6 space-y-4" onSubmit={submitPassword}>{isSignup && <label className="block text-sm font-semibold">Full name<GlassInput className="mt-2 px-4 py-3" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>}<label className="block text-sm font-semibold">College email<GlassInput className="mt-2 px-4 py-3" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@dept.vjti.ac.in" required /></label><label className="block text-sm font-semibold">Password<GlassInput className="mt-2 px-4 py-3" type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>{error && <p className="text-sm font-medium text-[var(--color-red)]" role="alert">{error}</p>}{message && <p className="text-sm font-medium text-[var(--color-green)]" role="status">{message}</p>}<GlassButton variant="primary" className="w-full px-4 py-3 text-sm font-semibold" disabled={pending}>{pending ? "Please wait..." : isSignup ? "Create account" : "Sign in"}</GlassButton></form><div className="my-5 flex items-center gap-3 text-xs text-[var(--color-muted)]"><span className="h-px flex-1 bg-[var(--color-separator)]" />or<span className="h-px flex-1 bg-[var(--color-separator)]" /></div><GlassButton className="w-full px-4 py-3 text-sm font-semibold" onClick={sendMagicLink} disabled={pending}>Email me a magic link</GlassButton><p className="mt-6 text-center text-sm text-[var(--color-muted)]">{isSignup ? "Already have an account?" : "New to CampusGlass?"} <a className="font-semibold text-[var(--color-accent)]" href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</a></p></GlassCard>;
}