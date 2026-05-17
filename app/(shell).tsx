import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Gauge,
  LogOut,
  Menu,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Trophy,
  Users
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { getCurrentProfile } from "@/lib/supabase/server";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/seasons", label: "Seasons", icon: Trophy },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/players", label: "Players", icon: Users },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "/import-whatsapp", label: "WhatsApp", icon: MessageSquareText },
  { href: "/reports/payments", label: "Payments report", icon: BarChart3 },
  { href: "/reports/playground-stats", label: "Field stats", icon: Trophy },
  { href: "/settings", label: "Settings", icon: Settings }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link className="inline-flex items-center gap-3 font-semibold text-ink" href="/dashboard">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-pitch text-sm font-bold text-white shadow-sm">OU</span>
            <span className="leading-tight">
              <span className="block">Soccer Manager</span>
              <span className="block text-xs font-medium text-slate-500">Club operations</span>
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
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                className="inline-flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-pitch"
                href={href}
                key={href}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </details>
        <aside className="panel hidden gap-1 p-2 md:sticky md:top-20 md:grid md:self-start">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              className="inline-flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-pitch"
              href={href}
              key={href}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </aside>
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              Signed in as <span className="font-medium text-ink">{profile?.display_name ?? profile?.email ?? "Unknown"}</span>
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
