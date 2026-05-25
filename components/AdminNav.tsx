"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({ role }: { role?: UserRole }) {
  return <AppNav role={role} />;
}
