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

  it("stores default routing context in the database with scoped setters", () => {
    const defaults = migration("073_database_context_defaults.sql");
    expect(defaults).toContain("organizations_single_default_idx");
    expect(defaults).toContain("programs_single_default_per_organization_idx");
    expect(defaults).toContain("create or replace function public.resolve_default_route_context");
    expect(defaults).toContain("create or replace function public.set_my_default_context");
    expect(defaults).toContain("Active organization membership required");
    expect(defaults).toContain("Only the platform owner can set the public default context");
    expect(defaults).toContain("revoke all on function public.set_platform_default_context(uuid, uuid) from public, anon");
  });

  it("onboards organizations atomically with normalized template modules", () => {
    const onboarding = migration("074_organization_onboarding.sql");
    expect(onboarding).toContain("create table if not exists public.module_catalog");
    expect(onboarding).toContain("create table if not exists public.program_template_modules");
    expect(onboarding).toContain("create or replace function public.create_organization_onboarding");
    expect(onboarding).toContain("v_platform_role not in ('platform_owner', 'platform_superadmin')");
    expect(onboarding).toContain("'organization.onboarded'");
    expect(onboarding).toContain("'owner', 'manager'");
    expect(onboarding).toContain("Required program modules cannot be disabled");
    expect(onboarding).toContain("revoke all on function public.create_organization_onboarding");
  });

  it("reserves global template creation for the platform owner", () => {
    const onboarding = migration("074_organization_onboarding.sql");
    expect(onboarding).toContain("create or replace function public.create_program_template");
    expect(onboarding).toContain("if public.platform_role() <> 'platform_owner'");
  });

  it("schema-qualifies the pgcrypto invitation digest", () => {
    const fix = migration("075_fix_invitation_digest_schema.sql");
    expect(fix).toContain("extensions.digest(p_token, 'sha256')");
    expect(fix).toContain("grant execute on function public.accept_invitation(text) to authenticated");
  });
});
