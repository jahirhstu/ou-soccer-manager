import Link from "next/link";
import {
  LogOut,
  Menu,
  ShieldCheck
} from "lucide-react";
import { AdminNav } from "@/components/AdminNav";
import { logoutAction } from "@/lib/actions/auth";
import { getCurrentProfile } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  const homeHref = roleHomeHref(profile?.role);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link className="inline-flex items-center gap-3 font-semibold text-ink" href={homeHref}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-pitch text-sm font-bold text-white shadow-sm">OU</span>
            <span className="leading-tight">
              <span className="block">Soccer Manager</span>
              <span className="block text-xs font-medium text-slate-500">{profile?.organization_name ?? "Club operations"}</span>
            </span>
          </Link>
          <form action={logoutAction}>
            <button className="btn-secondary min-h-9 px-3">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
        <details className="panel group md:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <Menu className="h-4 w-4 text-pitch" />
              Menu
            </span>
            <span className="text-xs font-medium text-slate-500 group-open:hidden">Open</span>
            <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Close</span>
          </summary>
          <nav className="grid gap-1 border-t border-line p-2">
            <AdminNav role={profile?.role} />
          </nav>
        </details>
        <aside className="panel hidden gap-1 p-2 md:sticky md:top-20 md:grid md:self-start">
          <AdminNav role={profile?.role} />
        </aside>
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              Signed in as <span className="font-medium text-ink">{profile?.display_name ?? profile?.email ?? "Unknown"}</span>
              {profile?.organization_name ? <span> - {profile.organization_name}</span> : null}
            </div>
            {profile?.role ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                {profile.role}
              </span>
            ) : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function roleHomeHref(role: UserRole | undefined) {
  if (role === "admin") return "/dashboard";
  if (role === "captain") return "/sessions";
  return "/public/report";
}
