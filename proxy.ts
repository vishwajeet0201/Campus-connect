import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const publicPaths = ["/login", "/signup", "/auth/callback"];

export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const pathname = request.nextUrl.pathname;
  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!user) {
    if (isPublic) return response;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
  }

  if (!user.email_confirmed_at && !isPublic) {
    return NextResponse.redirect(new URL("/login?error=verify", request.url));
  }

  const { data: profile } = await supabase.from("profiles").select("onboarded").eq("id", user.id).maybeSingle();
  if (!profile?.onboarded && pathname !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  if (profile?.onboarded && pathname === "/onboarding") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff2)$).*)"],
};