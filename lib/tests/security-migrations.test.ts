import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");

describe("tenant security migrations", () => {
  it("removes anonymous and direct authenticated score writes", () => {
    const onboarding = migration("061_platform_onboarding_and_tenant_hardening.sql");
    const authorization = migration("063_program_authorization.sql");
    expect(onboarding).toContain("revoke all on function public.public_save_game_scores(uuid, jsonb) from public, anon");
    expect(authorization).toContain("revoke all on function public.public_save_game_scores(uuid, jsonb) from authenticated");
    expect(authorization).toContain("public.program_role(v_program_id) not in ('manager', 'captain')");
  });

  it("revokes global public reports and exposes scoped replacements", () => {
    const reports = migration("062_scoped_public_reports.sql");
    expect(reports).toContain("revoke all on function public.public_player_report() from public, anon, authenticated");
    expect(reports).toContain("scoped_public_player_report");
    expect(reports).toContain("resolve_enabled_public_scope");
  });

  it("makes signup memberships pending and invitation roles explicit", () => {
    const onboarding = migration("061_platform_onboarding_and_tenant_hardening.sql");
    expect(onboarding).toContain("values (v_organization_id, new.id, 'player', 'pending')");
    expect(onboarding).toContain("create or replace function public.accept_invitation");
  });
});
