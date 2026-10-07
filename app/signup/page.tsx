import { AuthForm } from "@/components/auth/AuthForm";

export default function SignupPage() {
  return <main className="app-background min-h-screen px-4 py-8 text-[var(--color-ink)] sm:grid sm:place-items-center"><div className="w-full max-w-md"><AuthForm mode="signup" /></div></main>;
}