import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, LogOut, Menu } from "lucide-react";
import { AdminNav } from "@/components/AdminNav";
import { PublicNav } from "@/components/PublicNav";
import { logoutAction } from "@/lib/actions/auth";
import { getCurrentProfile } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export async function PublicShell({
  children,
  returnHref,
  returnLabel
}: {
  children: ReactNode;
  returnHref?: string;
  returnLabel?: string;
}) {
  const profile = await getCurrentProfile();
  const isLoggedIn = profile?.role === "admin" || profile?.role === "captain" || profile?.role === "player";
  const useAppNav = profile?.role === "admin" || profile?.role === "captain";
  const homeHref = roleHomeHref(profile?.role);
  const menuLabel = useAppNav ? "Menu" : "Public menu";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-3">
          <Link className="inline-flex min-w-0 items-center gap-3 font-semibold text-ink" href={homeHref}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pitch text-sm font-bold text-white shadow-sm">OU</span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate">Soccer Manager</span>
              <span className="block text-xs font-medium text-slate-500">{useAppNav ? "Club operations" : "Report Gallery"}</span>
            </span>
          </Link>
          {isLoggedIn ? (
            <form action={logoutAction}>
              <button className="btn-secondary min-h-9 px-3 text-xs sm:text-sm">
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </form>
          ) : (
            <Link className="btn-primary min-h-9 px-3 text-xs sm:text-sm" href="/login">
              Login
            </Link>
          )}
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-3 py-5 sm:px-4 md:grid-cols-[230px_1fr]">
        <details className="panel group md:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <Menu className="h-4 w-4 text-pitch" />
              {menuLabel}
            </span>
            <span className="text-xs font-medium text-slate-500 group-open:hidden">Open</span>
            <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Close</span>
          </summary>
          {useAppNav ? <AdminNav role={profile.role} /> : <PublicNav />}
        </details>
        <aside className="panel hidden p-2 md:sticky md:top-20 md:block md:self-start">
          {!useAppNav ? (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              <BarChart3 className="h-4 w-4" />
              Report Gallery
            </div>
          ) : null}
          {useAppNav ? <AdminNav role={profile.role} /> : <PublicNav />}
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function roleHomeHref(role: UserRole | undefined) {
  if (role === "admin") return "/dashboard";
  if (role === "captain") return "/sessions";
  return "/public/report";
}
