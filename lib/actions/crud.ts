"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attendanceSchema, expenseSchema, paymentSchema, playerSchema, programSchema, seasonSchema, sessionSchema } from "../schemas";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";
import { applySessionUsage } from "./session-usage";

async function requirePermission(permission: Parameters<typeof hasPermission>[1]) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, permission)) throw new Error("Unauthorized");
  return profile;
}

export async function saveProgram(formData: FormData) {
  const profile = await requirePermission("manage_all");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");
  const parsed = programSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const slug = await uniqueProgramSlug(supabase, profile.organization_id, parsed.name);
  const { data, error } = await supabase
    .from("programs")
    .insert({
      ...parsed,
      slug,
      organization_id: profile.organization_id,
      created_by: profile.id
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (data?.id) {
    await supabase.rpc("seed_program_modules", { p_program_id: data.id });
  }
  revalidatePath("/programs");
  redirect("/programs");
}

export async function saveSeason(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = seasonSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getDefaultProgramId(supabase, profile.organization_id));
  const { error } = await supabase.from("seasons").insert({ ...parsed, program_id: programId, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/seasons");
  redirect("/seasons");
}

export async function saveSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = sessionSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForSeason(supabase, parsed.season_id));
  const playgroundId = parsed.playground_id ?? (parsed.location ? await findOrCreatePlayground(supabase, parsed.location, profile.id) : undefined);
  const { error } = await supabase.from("sessions").insert({ ...parsed, program_id: programId, playground_id: playgroundId, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function savePlayer(formData: FormData) {
  await requirePermission("manage_finance");
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("players").insert(parsed);
  if (error) throw new Error(error.message);
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const playerId = String(formData.get("player_id"));
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data: oldPlayer } = await supabase.from("players").select("*").eq("id", playerId).single();
  const { error } = await supabase.from("players").update(parsed).eq("id", playerId);
  if (error) throw new Error(error.message);
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "player_updated",
    entity_type: "players",
    entity_id: playerId,
    old_data: oldPlayer,
    new_data: parsed
  });
  revalidatePath("/players");
  revalidatePath(`/players/${playerId}`);
  redirect(`/players/${playerId}`);
}

export async function savePayment(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = paymentSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForPayment(supabase, parsed.season_id, parsed.session_id));
  const { data, error } = await supabase.from("payments").insert({ ...parsed, program_id: programId, created_by: profile.id }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("ledger_entries").insert({
    program_id: programId,
    season_id: parsed.season_id,
    session_id: parsed.session_id,
    player_id: parsed.player_id,
    type: "payment_received",
    amount: parsed.amount,
    sessions_count: parsed.sessions_covered,
    description: parsed.reference_note ?? "Manual payment recorded",
    created_by: profile.id
  });
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "payment_created",
    entity_type: "payments",
    entity_id: data?.id,
    new_data: parsed
  });
  revalidatePath("/payments");
  redirect("/payments");
}

export async function saveExpense(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = expenseSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForExpense(supabase, parsed.season_id, parsed.session_id, profile.organization_id));
  const { data, error } = await supabase.from("club_expenses").insert({ ...parsed, program_id: programId, created_by: profile.id }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "expense_created",
    entity_type: "club_expenses",
    entity_id: data?.id,
    new_data: parsed
  });
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  redirect("/expenses");
}

export async function upsertAttendance(formData: FormData) {
  const profile = await requirePermission("manage_attendance");
  const parsed = attendanceSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForSession(supabase, parsed.session_id));
  const { error } = await supabase
    .from("attendance")
    .upsert({ ...parsed, program_id: programId, created_by: profile.id }, { onConflict: "session_id,player_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/attendance");
}

export async function updateSessionPrice(formData: FormData) {
  await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const price = formData.get("price_per_session");
  const parsedPrice = price === "" || price == null ? null : Number(price);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sessions")
    .update({ price_per_session: parsedPrice })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

export async function completeSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const supabase = await createSupabaseServerClient();

  await applySessionUsage({
    supabase,
    sessionId,
    actorId: profile.id,
    source: "session_completed",
    markSessionCompleted: true
  });

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  revalidatePath("/reports/payments");
}

function formDataToObject(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value === "" ? null : value])
  );
}

async function findOrCreatePlayground(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  name: string,
  actorId: string
) {
  const cleaned = name.trim();
  if (!cleaned) return undefined;
  const { data: existing, error: existingError } = await supabase
    .from("playgrounds")
    .select("id")
    .ilike("name", cleaned)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("playgrounds")
    .insert({ name: cleaned, created_by: actorId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function getProgramIdForSeason(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string
) {
  const { data, error } = await supabase.from("seasons").select("program_id").eq("id", seasonId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.program_id ?? undefined;
}

async function getProgramIdForSession(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  sessionId: string
) {
  const { data, error } = await supabase.from("sessions").select("program_id").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.program_id ?? undefined;
}

async function getProgramIdForPayment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string,
  sessionId?: string
) {
  if (sessionId) {
    const sessionProgramId = await getProgramIdForSession(supabase, sessionId);
    if (sessionProgramId) return sessionProgramId;
  }
  return getProgramIdForSeason(supabase, seasonId);
}

async function getProgramIdForExpense(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string | undefined,
  sessionId: string | undefined,
  organizationId?: string | null
) {
  if (sessionId) {
    const sessionProgramId = await getProgramIdForSession(supabase, sessionId);
    if (sessionProgramId) return sessionProgramId;
  }
  if (seasonId) {
    const seasonProgramId = await getProgramIdForSeason(supabase, seasonId);
    if (seasonProgramId) return seasonProgramId;
  }
  return getDefaultProgramId(supabase, organizationId);
}

async function getDefaultProgramId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId?: string | null
) {
  if (!organizationId) return undefined;
  const { data, error } = await supabase.rpc("ensure_default_program", { p_organization_id: organizationId });
  if (error) throw new Error(error.message);
  return data ?? undefined;
}

async function uniqueProgramSlug(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  name: string
) {
  const base = normalizeSlug(name) || "program";
  let slug = base;
  let counter = 2;
  while (true) {
    const { data, error } = await supabase
      .from("programs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
    slug = `${base}-${counter}`;
    counter += 1;
  }
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
