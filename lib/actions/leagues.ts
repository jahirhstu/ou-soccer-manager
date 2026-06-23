"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { leagueSchema, leagueTeamSchema } from "@/lib/schemas";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { requireEnabledProgramModule } from "@/lib/program-access";

async function requireLeagueAdmin() {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Unauthorized");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");
  return profile;
}

export async function saveLeague(formData: FormData) {
  const profile = await requireLeagueAdmin();
  const parsed = leagueSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  await requireEnabledProgramModule(supabase, profile.organization_id, parsed.program_id, "leagues");
  const slug = await uniqueLeagueSlug(supabase, profile.organization_id, parsed.name);
  const { data, error } = await supabase
    .from("leagues")
    .insert({
      ...parsed,
      slug,
      organization_id: profile.organization_id,
      program_id: parsed.program_id,
      created_by: profile.id
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/leagues");
  redirect(`/leagues/${data.id}`);
}

export async function saveLeagueTeam(_: unknown, formData: FormData) {
  try {
    const profile = await requireLeagueAdmin();
    const parsed = leagueTeamSchema.parse({
      ...formDataToObject(formData),
      player_ids: formData.getAll("player_ids").filter(Boolean)
    });
    const supabase = await createSupabaseServerClient();
    const programId = await requireLeagueProgram(supabase, profile.organization_id, parsed.league_id);
    const { data: team, error } = await supabase
      .from("league_teams")
      .upsert(
        {
          captain_player_id: parsed.captain_player_id,
          created_by: profile.id,
          league_id: parsed.league_id,
          name: parsed.name,
          organization_id: profile.organization_id,
          program_id: programId,
          seed_order: parsed.seed_order
        },
        { onConflict: "league_id,name" }
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: deleteError } = await supabase.from("league_team_players").delete().eq("league_team_id", team.id);
    if (deleteError) throw new Error(deleteError.message);

    const rows = parsed.player_ids.map((playerId) => ({
      created_by: profile.id,
      league_id: parsed.league_id,
      league_team_id: team.id,
      organization_id: profile.organization_id,
      program_id: programId,
      player_id: playerId
    }));
    if (rows.length) {
      const { error: playerError } = await supabase.from("league_team_players").insert(rows);
      if (playerError) throw new Error(playerError.message);
    }

    revalidatePath(`/leagues/${parsed.league_id}`);
    return { success: true, message: "League team saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save league team." };
  }
}

export async function generateLeagueFixtures(formData: FormData) {
  const profile = await requireLeagueAdmin();
  const leagueId = String(formData.get("league_id") ?? "");
  if (!leagueId) throw new Error("League is missing.");

  const supabase = await createSupabaseServerClient();
  const programId = await requireLeagueProgram(supabase, profile.organization_id, leagueId);
  const { data: teams, error } = await supabase
    .from("league_teams")
    .select("id")
    .eq("league_id", leagueId)
    .order("seed_order", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  if (!teams || teams.length < 2) throw new Error("Add at least two teams before generating fixtures.");

  const fixtures = roundRobin(teams.map((team) => team.id)).map((fixture, index) => ({
    created_by: profile.id,
    league_id: leagueId,
    match_number: index + 1,
    organization_id: profile.organization_id,
    program_id: programId,
    round_number: fixture.round,
    status: "scheduled",
    team_a_id: fixture.teamAId,
    team_b_id: fixture.teamBId
  }));

  const { error: deleteError } = await supabase.from("league_matches").delete().eq("league_id", leagueId);
  if (deleteError) throw new Error(deleteError.message);
  const { error: insertError } = await supabase.from("league_matches").insert(fixtures);
  if (insertError) throw new Error(insertError.message);

  await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId);
  revalidatePath(`/leagues/${leagueId}`);
}

export async function saveLeagueMatchResult(formData: FormData) {
  const profile = await requireLeagueAdmin();
  const leagueId = String(formData.get("league_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const teamAScore = Number(formData.get("team_a_score") ?? 0);
  const teamBScore = Number(formData.get("team_b_score") ?? 0);
  if (!leagueId || !matchId) throw new Error("League match is missing.");

  const supabase = await createSupabaseServerClient();
  await requireLeagueProgram(supabase, profile.organization_id, leagueId);
  const { error } = await supabase
    .from("league_matches")
    .update({
      status: "completed",
      team_a_score: Math.max(0, teamAScore),
      team_b_score: Math.max(0, teamBScore)
    })
    .eq("id", matchId);
  if (error) throw new Error(error.message);
  revalidatePath(`/leagues/${leagueId}`);
}

function formDataToObject(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value === "" ? null : value])
  );
}

async function uniqueLeagueSlug(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  name: string
) {
  const base = slugify(name) || "league";
  let slug = base;
  let suffix = 2;
  while (true) {
    const { data, error } = await supabase
      .from("leagues")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function requireLeagueProgram(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  leagueId: string
) {
  const { data, error } = await supabase.from("leagues").select("program_id").eq("id", leagueId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.program_id) throw new Error("League program context is missing.");
  await requireEnabledProgramModule(supabase, organizationId, data.program_id, "leagues");
  return data.program_id;
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function roundRobin(teamIds: string[]) {
  const teams = [...teamIds];
  if (teams.length % 2 === 1) teams.push("");
  const rounds = teams.length - 1;
  const half = teams.length / 2;
  const fixtures: Array<{ round: number; teamAId: string; teamBId: string }> = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (let index = 0; index < half; index += 1) {
      const teamAId = teams[index];
      const teamBId = teams[teams.length - 1 - index];
      if (teamAId && teamBId) {
        fixtures.push(round % 2 === 0 ? { round, teamAId: teamBId, teamBId: teamAId } : { round, teamAId, teamBId });
      }
    }
    teams.splice(1, 0, teams.pop()!);
  }

  return fixtures;
}
