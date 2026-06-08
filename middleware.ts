import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "./lib/supabase/env";
import { getTenantSlugFromPathname, normalizeTenantSlug, stripTenantFromPathname, tenantPath } from "./lib/tenant";

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
  const tenantSlug = getTenantSlugFromPathname(request.nextUrl.pathname);
  const pathname = tenantSlug ? stripTenantFromPathname(request.nextUrl.pathname) : request.nextUrl.pathname;
  const cookieTenantSlug = normalizeTenantSlug(request.cookies.get("active_organization_slug")?.value);
  const requestHeaders = new Headers(request.headers);
  if (tenantSlug) requestHeaders.set("x-tenant-slug", tenantSlug);

  if (!tenantSlug && cookieTenantSlug && pathname !== "/setup") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = tenantPath(pathname === "/" ? "/public/report" : pathname, cookieTenantSlug);
    return NextResponse.redirect(redirectUrl);
  }

  if (!hasSupabaseEnv()) {
    if (pathname === "/setup") return createTenantResponse(request, pathname, tenantSlug, requestHeaders);
    return NextResponse.redirect(new URL(tenantPath("/setup", tenantSlug), request.url));
  }

  if (tenantSlug && pathname === "/") {
    return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug), request.url));
  }

  let response = createTenantResponse(request, pathname, tenantSlug, requestHeaders);
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = createTenantResponse(request, pathname, tenantSlug, requestHeaders);
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );
  const { data } = await supabase.auth.getUser();
  const isPublic =
    publicRoutes.includes(pathname) ||
    publicRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!data.user && !isPublic) {
    return NextResponse.redirect(new URL(tenantPath("/login", tenantSlug), request.url));
  }
  if (data.user && pathname === "/") return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug), request.url));
  if (data.user && !isPublic) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    let membershipQuery = supabase
      .from("organization_members")
      .select(tenantSlug ? "role,organizations!inner(slug)" : "role")
      .eq("profile_id", data.user.id);
    if (tenantSlug) membershipQuery = membershipQuery.eq("organizations.slug", tenantSlug);
    const { data: membership } = await membershipQuery.order("created_at").limit(1).maybeSingle();
    const role = profile?.role === "admin" ? "admin" : membership?.role === "owner" ? "admin" : membership?.role ?? profile?.role;
    if (role === "player") {
      if (isPlayerAllowedRoute(pathname)) return withTenantCookie(response, tenantSlug);
      return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug), request.url));
    }
    if (role === "captain") {
      if (pathname === "/dashboard") return NextResponse.redirect(new URL(tenantPath("/sessions", tenantSlug), request.url));
      const isCaptainRoute = isCaptainAllowedRoute(pathname);
      if (!isCaptainRoute) return NextResponse.redirect(new URL(tenantPath("/sessions", tenantSlug), request.url));
    }
  }
  return withTenantCookie(response, tenantSlug);
}

function createTenantResponse(request: NextRequest, pathname: string, tenantSlug: string, headers: Headers) {
  if (!tenantSlug) return NextResponse.next({ request: { headers } });
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return withTenantCookie(NextResponse.rewrite(url, { request: { headers } }), tenantSlug);
}

function withTenantCookie(response: NextResponse, tenantSlug: string) {
  if (tenantSlug) response.cookies.set("active_organization_slug", tenantSlug, { path: "/", sameSite: "lax" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
