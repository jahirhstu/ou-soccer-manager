import { z } from "zod";
import { expenseSchema, paymentSchema, playerSchema, programSchema, seasonSchema, sessionSchema } from "@/lib/schemas";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["create_program", "create_season", "create_session", "create_player", "create_payment", "create_expense"]),
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

    const parsed = expenseSchema.parse(input.data);
    const programId = parsed.program_id ?? (parsed.season_id ? await programForSeason(supabase, parsed.season_id) : null);
    const { data, error } = await supabase.from("club_expenses").insert({ ...parsed, program_id: programId, organization_id: actor.organizationId, created_by: actor.profileId }).select("id").single();
    if (error) throw new Error(error.message);
    await audit(supabase, actor, "expense_created", "club_expenses", data.id, parsed);
    return Response.json({ ok: true, id: data.id });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
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
