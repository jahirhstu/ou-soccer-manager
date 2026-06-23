import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "./lib/supabase/env";
import { getActiveProgramSlugForTenant, getProgramSlugFromPathname, getTenantSlugFromPathname, normalizeTenantSlug, stripTenantFromPathname, tenantPath } from "./lib/tenant";

const publicRoutes = ["/", "/login", "/signup", "/setup"];
const publicRoutePrefixes = ["/public", "/invite"];
const globalContextRoutes = ["/login", "/signup", "/join", "/select-context", "/invite", "/platform"];
const captainAllowedPaths = ["/sessions", "/performance", "/leagues", "/attendance", "/reports/leaderboards", "/reports/playground-stats"];
const programRequiredPaths = ["/sessions", "/seasons", "/players", "/payments", "/expenses", "/attendance", "/performance", "/leagues", "/import-whatsapp", "/reports"];

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

type RouteContext = {
  organization_id: string;
  program_id: string | null;
};

export async function middleware(request: NextRequest) {
  const tenantSlug = getTenantSlugFromPathname(request.nextUrl.pathname);
  const programSlug = tenantSlug ? getProgramSlugFromPathname(request.nextUrl.pathname) : "";
  const pathname = tenantSlug ? stripTenantFromPathname(request.nextUrl.pathname) : request.nextUrl.pathname;
  const cookieTenantSlug = normalizeTenantSlug(request.cookies.get("active_organization_slug")?.value);
  const cookieProgramTenantSlug = normalizeTenantSlug(request.cookies.get("active_program_organization_slug")?.value);
  const cookieProgramSlug = normalizeTenantSlug(request.cookies.get("active_program_slug")?.value);
  let activeProgramSlug = programSlug || getActiveProgramSlugForTenant(tenantSlug, cookieProgramTenantSlug, cookieProgramSlug);
  const requestHeaders = new Headers(request.headers);
  if (tenantSlug) requestHeaders.set("x-tenant-slug", tenantSlug);
  if (programSlug) requestHeaders.set("x-program-slug", programSlug);
  if (activeProgramSlug) requestHeaders.set("x-active-program-slug", activeProgramSlug);

  if (!tenantSlug && cookieTenantSlug && pathname !== "/setup" && !globalContextRoutes.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = tenantPath(pathname === "/" ? "/public/report" : pathname, cookieTenantSlug);
    return NextResponse.redirect(redirectUrl);
  }

  if (!hasSupabaseEnv()) {
    if (pathname === "/setup") return createTenantResponse(request, pathname, tenantSlug, programSlug, requestHeaders);
    return NextResponse.redirect(new URL(tenantPath("/setup", tenantSlug, programSlug), request.url));
  }

  if (tenantSlug && pathname === "/") {
    return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug, programSlug), request.url));
  }

  let response = createTenantResponse(request, pathname, tenantSlug, programSlug, requestHeaders);
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = createTenantResponse(request, pathname, tenantSlug, programSlug, requestHeaders);
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  let organizationId: string | null = null;
  let programId: string | null = null;
  let activeProgramId: string | null = null;
  if (tenantSlug) {
    const { data: routeContext } = await supabase
      .rpc("resolve_public_route_context", {
        p_organization_slug: tenantSlug,
        p_program_slug: programSlug || null
      })
      .maybeSingle();
    const resolvedRouteContext = routeContext as RouteContext | null;
    if (!resolvedRouteContext?.organization_id) return NextResponse.rewrite(new URL("/_not-found", request.url), { request: { headers: requestHeaders } });
    if (programSlug && !resolvedRouteContext.program_id) return NextResponse.rewrite(new URL("/_not-found", request.url), { request: { headers: requestHeaders } });
    organizationId = resolvedRouteContext.organization_id;
    programId = resolvedRouteContext.program_id;
    activeProgramId = programId;
    if (!programSlug && activeProgramSlug) {
      const { data: activeRouteContext } = await supabase
        .rpc("resolve_public_route_context", {
          p_organization_slug: tenantSlug,
          p_program_slug: activeProgramSlug
        })
        .maybeSingle();
      const resolvedActiveContext = activeRouteContext as RouteContext | null;
      if (resolvedActiveContext?.organization_id === organizationId && resolvedActiveContext.program_id) {
        activeProgramId = resolvedActiveContext.program_id;
      } else {
        activeProgramSlug = "";
        requestHeaders.delete("x-active-program-slug");
        response = createTenantResponse(request, pathname, tenantSlug, programSlug, requestHeaders);
        response.cookies.delete("active_program_slug");
        response.cookies.delete("active_program_organization_slug");
      }
    }
  }

  if (tenantSlug && !programSlug && activeProgramSlug && activeProgramId && (pathname === "/public" || pathname.startsWith("/public/"))) {
    return NextResponse.redirect(new URL(tenantPath(pathname, tenantSlug, activeProgramSlug), request.url));
  }

  const { data } = await supabase.auth.getUser();
  const isPublic =
    publicRoutes.includes(pathname) ||
    publicRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!data.user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (data.user && tenantSlug && !programSlug && !isPublic && programRequiredPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    if (activeProgramSlug && activeProgramId) {
      return NextResponse.redirect(new URL(tenantPath(pathname, tenantSlug, activeProgramSlug), request.url));
    }
    return NextResponse.redirect(new URL("/select-context", request.url));
  }
  if (data.user && pathname === "/") return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug, programSlug), request.url));
  if (data.user && !isPublic) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    let membershipQuery = supabase
      .from("organization_members")
      .select("role")
      .eq("profile_id", data.user.id);
    if (organizationId) membershipQuery = membershipQuery.eq("organization_id", organizationId);
    membershipQuery = membershipQuery.eq("status", "active");
    const { data: membership } = await membershipQuery.order("created_at").limit(1).maybeSingle();
    let hasPlatformAccess = false;
    if (organizationId && !membership) {
      const { data: platformAccess } = await supabase.rpc("has_platform_organization_access", { p_organization_id: organizationId });
      hasPlatformAccess = platformAccess === true;
      if (!hasPlatformAccess) return NextResponse.redirect(new URL("/join?error=access_required", request.url));
    }
    let role = hasPlatformAccess || membership?.role === "owner" ? "admin" : membership?.role ?? profile?.role;
    if (programSlug && data.user && role !== "admin") {
      const { data: programMembership } = await supabase
        .from("program_members")
        .select("role")
        .eq("profile_id", data.user.id)
        .eq("program_id", programId ?? "00000000-0000-0000-0000-000000000000")
        .eq("status", "active")
        .maybeSingle();
      if (!programMembership) return NextResponse.redirect(new URL("/join?error=program_access_required", request.url));
      role = programMembership.role === "manager" ? "admin" : programMembership.role;
    }
    if (role === "player") {
      if (isPlayerAllowedRoute(pathname)) return withTenantCookie(response, tenantSlug, programSlug);
      return NextResponse.redirect(new URL(tenantPath("/public/report", tenantSlug, programSlug), request.url));
    }
    if (role === "captain") {
      if (pathname === "/dashboard") return NextResponse.redirect(new URL(tenantPath("/sessions", tenantSlug, programSlug), request.url));
      const isCaptainRoute = isCaptainAllowedRoute(pathname);
      if (!isCaptainRoute) return NextResponse.redirect(new URL(tenantPath("/sessions", tenantSlug, programSlug), request.url));
    }
  }
  return withTenantCookie(response, tenantSlug, programSlug);
}

function createTenantResponse(request: NextRequest, pathname: string, tenantSlug: string, programSlug: string, headers: Headers) {
  if (!tenantSlug) return NextResponse.next({ request: { headers } });
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return withTenantCookie(NextResponse.rewrite(url, { request: { headers } }), tenantSlug, programSlug);
}

function withTenantCookie(response: NextResponse, tenantSlug: string, programSlug = "") {
  if (tenantSlug) response.cookies.set("active_organization_slug", tenantSlug, { path: "/", sameSite: "lax" });
  if (programSlug) {
    response.cookies.set("active_program_slug", programSlug, { path: "/", sameSite: "lax" });
    response.cookies.set("active_program_organization_slug", tenantSlug, { path: "/", sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
