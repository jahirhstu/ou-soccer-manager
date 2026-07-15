import { z } from "zod";
import { confirmWhatsAppImport, parseWhatsAppAction } from "@/lib/actions/import";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

const inputSchema = z.object({ organizationId: z.string().uuid(), action: z.enum(["parse", "confirm"]), rawText: z.string().min(2), parsed: z.unknown().optional(), seasonId: z.string().optional(), sessionId: z.string().optional(), matches: z.record(z.string(), z.string()).optional(), ignoredNames: z.array(z.string()).optional(), updateNames: z.array(z.string()).optional(), createSeason: z.record(z.string(), z.unknown()).optional(), createSession: z.record(z.string(), z.unknown()).optional() });
export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json()); const { supabase, actor } = await authenticateMobileRequest(request, input.organizationId); requireMobileRole(actor, ["admin"]); const profile = { id: actor.profileId, role: actor.role, player_id: actor.playerId, organization_id: actor.organizationId, email: actor.user.email };
    const form = new FormData(); form.set("rawText", input.rawText);
    if (input.action === "parse") { const result = await parseWhatsAppAction(null, form, { profile, supabase }); return Response.json(result); }
    form.set("parsedJson", JSON.stringify(input.parsed ?? {})); if (input.seasonId) form.set("seasonId", input.seasonId); if (input.sessionId) form.set("sessionId", input.sessionId); for (const [name, playerId] of Object.entries(input.matches ?? {})) form.set(`match_${name}`, playerId); for (const name of input.ignoredNames ?? []) form.set(`match_${name}`, "__ignore__"); for (const name of input.updateNames ?? []) form.set(`update_name_${name}`, "yes"); for (const [key, value] of Object.entries(input.createSeason ?? {})) if (value != null) form.set(key, String(value)); for (const [key, value] of Object.entries(input.createSession ?? {})) if (value != null) form.set(key, String(value)); const result = await confirmWhatsAppImport(null, form, { profile, supabase }); return Response.json(result);
  } catch (error) { return mobileApiErrorResponse(error); }
}
