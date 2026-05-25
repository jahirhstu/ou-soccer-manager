"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Gauge,
  MapPinned,
  MessageSquareText,
  Settings,
  Target,
  Trophy,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavVariant = "app" | "public";
type NavItem = {
  href: string;
  label: string;
  subLabel?: string;
  icon: LucideIcon;
  roles: UserRole[];
};

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Club",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge, roles: ["admin"] },
      { href: "/sessions", label: "Sessions", icon: CalendarDays, roles: ["admin", "captain"] },
      { href: "/attendance", label: "Attendance", icon: ClipboardCheck, roles: ["admin", "captain"] },
      { href: "/reports/leaderboards", label: "Leaderboards", icon: Trophy, roles: ["admin", "captain"] },
      { href: "/reports/playground-stats", label: "Field stats", icon: MapPinned, roles: ["admin", "captain"] }
    ]
  },
  {
    label: "Admin",
    items: [
      { href: "/seasons", label: "Seasons", icon: Trophy, roles: ["admin"] },
      { href: "/players", label: "Players", icon: Users, roles: ["admin"] },
      { href: "/payments", label: "Payments", icon: CreditCard, roles: ["admin"] },
      { href: "/import-whatsapp", label: "WhatsApp", icon: MessageSquareText, roles: ["admin"] },
      { href: "/reports/payments", label: "Payments report", icon: BarChart3, roles: ["admin"] },
      { href: "/settings", label: "Settings", icon: Settings, roles: ["admin"] }
    ]
  },
  {
    label: "Report Gallery",
    items: [
      { href: "/public/report", label: "Status", subLabel: "Players and balances", icon: ClipboardList, roles: ["admin", "captain", "player"] },
      { href: "/public/goals-assists", label: "Goals & Assists", subLabel: "Players and rates", icon: Target, roles: ["admin", "captain", "player"] },
      { href: "/public/sessions", label: "Sessions", subLabel: "Games and scores", icon: CalendarDays, roles: ["admin", "captain", "player"] },
      { href: "/public/leaderboards", label: "Leaderboards", subLabel: "Teams and captains", icon: Trophy, roles: ["admin", "captain", "player"] },
      { href: "/public/field-status", label: "Field Status", subLabel: "By playground", icon: MapPinned, roles: ["admin", "captain", "player"] }
    ]
  }
];

export function AppNav({ role, variant = "app" }: { role?: UserRole; variant?: NavVariant }) {
  const pathname = usePathname();
  const sections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isVisible(item, role, variant))
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {sections.map((section) => (
        <div className="grid gap-1" key={section.label}>
          {variant === "app" && sections.length > 1 ? (
            <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase text-slate-400 first:pt-1">{section.label}</div>
          ) : null}
          {section.items.map(({ href, icon: Icon, label, subLabel }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid min-h-10 grid-cols-[20px_1fr] items-center gap-x-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-pitch",
                  active && "bg-emerald-50 font-semibold text-pitch ring-1 ring-emerald-100"
                )}
                href={href}
                key={href}
              >
                <Icon className="h-4 w-4" />
                <span>
                  <span className="block leading-tight">{label}</span>
                  {subLabel ? <span className={cn("block text-xs font-normal text-slate-500", active && "text-emerald-700")}>{subLabel}</span> : null}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function isVisible(item: NavItem, role: UserRole | undefined, variant: NavVariant) {
  if (variant === "public") return item.roles.includes("player");
  if (!role || !item.roles.includes(role)) return false;
  if ((role === "admin" || role === "captain") && item.href.startsWith("/public/") && item.href !== "/public/report") return false;
  return true;
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
