import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { confirmWhatsAppImport, parseWhatsAppAction, type ImportContext } from "@/lib/actions/import-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in required." }, 401);
    if (Number(request.headers.get("content-length") ?? 0) > 300000) return reply({ error: "Import is too large." }, 413);
    const text = await request.text();
    if (text.length > 300000) return reply({ error: "Import is too large." }, 413);
    const input = JSON.parse(text);
    if (!/^[0-9a-f-]{36}$/i.test(input.programId ?? "")) return reply({ error: "Choose a program." }, 400);
    const { url, publishableKey } = getSupabaseEnv();
    const client = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const user = await client.auth.getUser(authorization.slice(7));
    if (user.error || !user.data.user) return reply({ error: "Sign in again." }, 401);
    const access = await client.rpc("mobile_program_access", { p_program_id: input.programId });
    const role = await client.rpc("program_role", { p_program_id: input.programId });
    const module = await client.rpc("is_program_module_enabled", { p_program_id: input.programId, p_module_key: "whatsapp_import" });
    if (access.error || !access.data || role.error || role.data !== "manager" || module.error || !module.data) return reply({ error: "Program import access required." }, 403);
    const program = await client.from("programs").select("id,organization_id").eq("id", input.programId).single();
    if (program.error) return reply({ error: "Program not found." }, 403);
    const context: ImportContext = { client, profile: { id: user.data.user.id, role: "admin", organization_id: program.data.organization_id }, program: program.data };
    if (input.action === "options") {
      const [players, aliases, seasons, sessions] = await Promise.all([
        client.from("players").select("id,display_name").eq("organization_id", context.profile.organization_id).order("display_name"),
        client.from("player_aliases").select("player_id,alias_name").eq("organization_id", context.profile.organization_id),
        client.from("seasons").select("id,name").eq("program_id", input.programId).order("start_date", { ascending: false }),
        client.from("sessions").select("id,name,session_date,season_id").eq("program_id", input.programId).order("session_date", { ascending: false })
      ]);
      const error = [players,aliases,seasons,sessions].find(result => result.error)?.error;
      if (error) return reply({ error: error.message }, 400);
      if ([players, aliases, seasons, sessions].some(result => (result.data?.length ?? 0) >= 1000)) return reply({ error: "Import scope is too large for this mobile review. Contact your administrator." }, 400);
      return reply({ players: players.data, aliases: aliases.data, seasons: seasons.data, sessions: sessions.data });
    }
    if (typeof input.rawText !== "string" || !input.rawText.trim() || input.rawText.length > 30000) return reply({ error: "Enter a message up to 30,000 characters." }, 400);
    const form = new FormData(); form.set("rawText", input.rawText);
    if (input.action === "parse") return reply(await parseWhatsAppAction(null, form, context));
    if (input.action !== "confirm") return reply({ error: "Unknown action." }, 400);
    if (!input.seasonId || !input.parsed || !Array.isArray(input.parsed.players)) return reply({ error: "Review the import and select a season." }, 400);
    form.set("seasonId", input.seasonId); if (input.sessionId) form.set("sessionId", input.sessionId);
    form.set("parsedJson", JSON.stringify(input.parsed));
    for (const player of input.parsed.players) {
      const selected = input.matches?.[player.name];
      if (typeof selected !== "string" || !selected) return reply({ error: `Select or ignore ${player.name}.` }, 400);
      form.set(`match_${player.name}`, selected);
    }
    return reply(await confirmWhatsAppImport(null, form, context));
  } catch {
    return reply({ error: "Import request could not be processed. Check the message and try again." }, 400);
  }
}
