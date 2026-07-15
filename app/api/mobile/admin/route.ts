import { z } from "zod";
import { expenseSchema, paymentSchema, playerSchema, programSchema, seasonSchema, sessionSchema } from "@/lib/schemas";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["create_program", "create_season", "create_session", "create_player", "create_payment", "create_expense", "update_user", "update_password", "cleanup"]),
  data: z.record(z.string(), z.unknown())
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const { supabase, actor } = await authenticateMobileRequest(request, input.organizationId);
    requireMobileRole(actor, ["admin"]);

    if (input.action === "create_program") {
      const parsed = programSchema.parse(input.data);
      const slug = await uniqueSlug(supabase, actor.organizationId, parsed.name);
      const { data, error } = await supabase.from("programs").insert({ ...parsed, slug, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      await supabase.rpc("seed_program_modules", { p_program_id: data.id });
      await audit(supabase, actor, "program_created", "programs", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }

    if (input.action === "create_season") {
      const parsed = seasonSchema.parse(input.data);
      const { data, error } = await supabase.from("seasons").insert({ ...parsed, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      await audit(supabase, actor, "season_created", "seasons", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }

    if (input.action === "create_player") {
      const parsed = playerSchema.parse(input.data);
      const { data, error } = await supabase.from("players").insert({ ...parsed, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      await audit(supabase, actor, "player_created", "players", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }

    if (input.action === "create_session") {
      const parsed = sessionSchema.parse(input.data);
      const programId = parsed.program_id ?? await programForSeason(supabase, parsed.season_id);
      const { data, error } = await supabase.from("sessions").insert({ ...parsed, program_id: programId, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      await audit(supabase, actor, "session_created", "sessions", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }

    if (input.action === "create_payment") {
      const parsed = paymentSchema.parse(input.data);
      const programId = parsed.program_id ?? await programForSeason(supabase, parsed.season_id);
      const { data, error } = await supabase.from("payments").insert({ ...parsed, program_id: programId, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      const { error: ledgerError } = await supabase.from("ledger_entries").insert({ organization_id: actor.organizationId, program_id: programId, season_id: parsed.season_id, session_id: parsed.session_id, player_id: parsed.player_id, type: "payment_received", amount: parsed.amount, sessions_count: parsed.sessions_covered, description: parsed.reference_note ?? "Manual payment recorded", created_by: actor.profileId });
      if (ledgerError) throw new Error(ledgerError.message);
      await audit(supabase, actor, "payment_created", "payments", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }

    if (input.action === "create_expense") {
      const parsed = expenseSchema.parse(input.data);
      const programId = parsed.program_id ?? (parsed.season_id ? await programForSeason(supabase, parsed.season_id) : null);
      const { data, error } = await supabase.from("club_expenses").insert({ ...parsed, program_id: programId, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
      if (error) throw new Error(error.message);
      await audit(supabase, actor, "expense_created", "club_expenses", data.id, parsed);
      return Response.json({ ok: true, id: data.id });
    }
    if (input.action === "update_user") {
      const parsed = z.object({ member_id: z.string().uuid(), role: z.enum(["owner", "admin", "captain", "player"]), player_id: z.string().uuid().nullable().optional() }).parse(input.data);
      const { data: member, error: memberError } = await supabase.from("organization_members").select("id,profile_id,role").eq("id", parsed.member_id).eq("organization_id", actor.organizationId).single();
      if (memberError) throw new Error(memberError.message);
      if (member.role === "owner" && parsed.role !== "owner") {
        const { count } = await supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", actor.organizationId).eq("role", "owner");
        if ((count ?? 0) <= 1) throw new Error("Every organization needs at least one owner.");
      }
      const playerId = parsed.player_id ?? null;
      const { error } = await supabase.from("organization_members").update({ role: parsed.role, player_id: playerId }).eq("id", parsed.member_id).eq("organization_id", actor.organizationId);
      if (error) throw new Error(error.message);
      const { error: profileError } = await supabase.from("profiles").update({ role: parsed.role === "owner" ? "admin" : parsed.role, player_id: playerId }).eq("id", member.profile_id);
      if (profileError) throw new Error(profileError.message);
      await audit(supabase, actor, "user_updated", "organization_members", parsed.member_id, parsed);
      return Response.json({ ok: true });
    }
    if (input.action === "update_password") {
      const parsed = z.object({ member_id: z.string().uuid(), password: z.string().min(6) }).parse(input.data);
      const { data: member, error } = await supabase.from("organization_members").select("profile_id").eq("id", parsed.member_id).eq("organization_id", actor.organizationId).single();
      if (error) throw new Error(error.message);
      const admin = createSupabaseAdminClient();
      const { error: passwordError } = await admin.auth.admin.updateUserById(member.profile_id, { password: parsed.password });
      if (passwordError) throw new Error(passwordError.message);
      await audit(supabase, actor, "user_password_updated", "organization_members", parsed.member_id, { password_changed: true });
      return Response.json({ ok: true });
    }
    const confirmation = z.object({ confirmation: z.literal("CLEANUP") }).parse(input.data);
    void confirmation;
    await cleanupOrganization(supabase, actor.organizationId);
    return Response.json({ ok: true });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}

const cleanupTables = ["whatsapp_imports", "league_team_players", "league_matches", "league_teams", "leagues", "goals", "session_team_lineups", "session_matches", "session_team_players", "session_teams", "session_player_charges", "ledger_entries", "dropouts", "attendance", "payments", "club_expenses", "sessions", "seasons", "playgrounds", "player_aliases", "players"];
async function cleanupOrganization(supabase: any, organizationId: string) {
  const { error: memberError } = await supabase.from("organization_members").update({ player_id: null }).eq("organization_id", organizationId).not("player_id", "is", null);
  if (memberError) throw new Error(memberError.message);
  const { data: members } = await supabase.from("organization_members").select("profile_id").eq("organization_id", organizationId);
  const profileIds = (members ?? []).map((member: any) => member.profile_id);
  if (profileIds.length) await supabase.from("profiles").update({ player_id: null }).in("id", profileIds);
  for (const table of cleanupTables) { const { error } = await supabase.from(table).delete().eq("organization_id", organizationId); if (error) throw new Error(`Could not clean ${table}: ${error.message}`); }
}

async function uniqueSlug(supabase: any, organizationId: string, name: string) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "program";
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const { data } = await supabase.from("programs").select("id").eq("organization_id", organizationId).eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  throw new Error("Could not create a unique program slug.");
}

async function programForSeason(supabase: any, seasonId: string) {
  const { data, error } = await supabase.from("seasons").select("program_id").eq("id", seasonId).single();
  if (error || !data?.program_id) throw new Error(error?.message ?? "Season has no program.");
  return data.program_id as string;
}

async function audit(supabase: any, actor: any, action: string, entityType: string, entityId: string, newData: unknown) {
  const { error } = await supabase.from("audit_logs").insert({ organization_id: actor.organizationId, actor_id: actor.profileId, action, entity_type: entityType, entity_id: entityId, new_data: newData });
  if (error) throw new Error(error.message);
}
