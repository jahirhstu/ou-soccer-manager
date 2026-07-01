"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Gauge,
  Layers3,
  MapPinned,
  MessageSquareText,
  Percent,
  ReceiptText,
  Settings,
  Target,
  Trophy,
  UserCog,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/types";
import { stripTenantFromPathname, tenantPath } from "@/lib/tenant";
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
      { href: "/dashboard", label: "Dashboard", subLabel: "Club overview", icon: Gauge, roles: ["admin"] },
      { href: "/programs", label: "Programs", subLabel: "Sports and events", icon: Layers3, roles: ["admin"] },
      { href: "/sessions", label: "Sessions", subLabel: "Games and attendance", icon: CalendarDays, roles: ["admin", "captain"] },
      { href: "/performance", label: "Performance", subLabel: "Draft ratings", icon: Percent, roles: ["admin", "captain"] },
      { href: "/leagues", label: "Leagues", subLabel: "Teams and fixtures", icon: Trophy, roles: ["admin", "captain"] },
      { href: "/attendance", label: "Attendance", subLabel: "Player check-ins", icon: ClipboardCheck, roles: ["admin", "captain"] },
      { href: "/reports/leaderboards", label: "Leaderboards", subLabel: "Teams and captains", icon: Trophy, roles: ["admin", "captain"] },
      { href: "/reports/playground-stats", label: "Field stats", subLabel: "By playground", icon: MapPinned, roles: ["admin", "captain"] }
    ]
  },
  {
    label: "Admin",
    items: [
      { href: "/seasons", label: "Seasons", subLabel: "Session groups", icon: Trophy, roles: ["admin"] },
      { href: "/players", label: "Players", subLabel: "Profiles and status", icon: Users, roles: ["admin"] },
      { href: "/users", label: "Users", subLabel: "Roles and mappings", icon: UserCog, roles: ["admin"] },
      { href: "/payments", label: "Payments", subLabel: "Received amounts", icon: CreditCard, roles: ["admin"] },
      { href: "/notifications", label: "Notifications", subLabel: "Payment alerts", icon: Bell, roles: ["admin"] },
      { href: "/expenses", label: "Expenses", subLabel: "Club spending", icon: ReceiptText, roles: ["admin"] },
      { href: "/import-whatsapp", label: "WhatsApp", subLabel: "Parse group updates", icon: MessageSquareText, roles: ["admin"] },
      { href: "/reports/payments", label: "Payments report", subLabel: "Balances and usage", icon: BarChart3, roles: ["admin"] },
      { href: "/settings", label: "Settings", subLabel: "Roles and cleanup", icon: Settings, roles: ["admin"] }
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

export function AppNav({
  unreadNotificationCount = 0,
  role,
  tenantSlug,
  programSlug,
  variant = "app"
}: {
  unreadNotificationCount?: number;
  role?: UserRole;
  tenantSlug?: string | null;
  programSlug?: string | null;
  variant?: NavVariant;
}) {
  const pathname = usePathname();
  const internalPathname = stripTenantFromPathname(pathname);
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
            const active = isActive(internalPathname, href);
            const showUnreadCount = href === "/notifications" && unreadNotificationCount > 0;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid min-h-12 grid-cols-[20px_1fr] items-center gap-x-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-pitch",
                  active && "bg-emerald-50 font-semibold text-pitch ring-1 ring-emerald-100"
                )}
                href={tenantPath(href, tenantSlug, programSlug)}
                key={href}
              >
                <Icon className="h-4 w-4" />
                <span>
                  <span className="flex min-w-0 items-center justify-between gap-2 leading-tight">
                    <span className="truncate">{label}</span>
                    {showUnreadCount ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                        {unreadNotificationCount}
                      </span>
                    ) : null}
                  </span>
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
