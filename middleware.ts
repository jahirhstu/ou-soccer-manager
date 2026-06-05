import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "./lib/supabase/env";

const publicRoutes = ["/", "/login", "/signup", "/setup"];
const publicRoutePrefixes = ["/public"];
const captainAllowedPaths = ["/sessions", "/leagues", "/attendance", "/reports/leaderboards", "/reports/playground-stats"];

function isCaptainAllowedRoute(pathname: string) {
  if (pathname === "/sessions") return true;
  if (captainAllowedPaths.some((path) => path !== "/sessions" && (pathname === path || pathname.startsWith(`${path}/`)))) {
    return true;
  }
  if (/^\/sessions\/[^/]+$/.test(pathname)) return true;
  return /^\/sessions\/[^/]+\/(?:fixture|lineups|scores)(?:\/.*)?$/.test(pathname);
}

function isPlayerAllowedRoute(pathname: string) {
  return /^\/sessions\/[^/]+\/lineups(?:\/.*)?$/.test(pathname);
}

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function middleware(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    if (request.nextUrl.pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );
  const { data } = await supabase.auth.getUser();
  const isPublic =
    publicRoutes.includes(request.nextUrl.pathname) ||
    publicRoutePrefixes.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));
  if (!data.user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (data.user && request.nextUrl.pathname === "/") return NextResponse.redirect(new URL("/public/report", request.url));
  if (data.user && !isPublic) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("profile_id", data.user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    const role = profile?.role === "admin" ? "admin" : membership?.role === "owner" ? "admin" : membership?.role ?? profile?.role;
    if (role === "player") {
      if (isPlayerAllowedRoute(request.nextUrl.pathname)) return response;
      return NextResponse.redirect(new URL("/public/report", request.url));
    }
    if (role === "captain") {
      if (request.nextUrl.pathname === "/dashboard") return NextResponse.redirect(new URL("/sessions", request.url));
      const isCaptainRoute = isCaptainAllowedRoute(request.nextUrl.pathname);
      if (!isCaptainRoute) return NextResponse.redirect(new URL("/sessions", request.url));
    }
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
