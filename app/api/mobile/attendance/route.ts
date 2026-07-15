import { z } from "zod";
import { applySessionUsage } from "@/lib/actions/session-usage";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  playerId: z.string().uuid(),
  status: z.enum(["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"]),
  notes: z.string().max(500).optional().nullable()
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const { supabase, actor } = await authenticateMobileRequest(request, input.organizationId);
    requireMobileRole(actor, ["admin", "captain"]);
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id,organization_id")
      .eq("id", input.sessionId)
      .eq("organization_id", actor.organizationId)
      .single();
    if (sessionError || !session) throw new Error(sessionError?.message ?? "Session not found.");
    const { error } = await supabase.from("attendance").upsert({
      organization_id: actor.organizationId,
      session_id: input.sessionId,
      player_id: input.playerId,
      status: input.status,
      notes: input.notes ?? null,
      created_by: actor.profileId
    }, { onConflict: "session_id,player_id" });
    if (error) throw new Error(error.message);
    const usage = await applySessionUsage({
      supabase: supabase as any,
      sessionId: input.sessionId,
      actorId: actor.profileId,
      source: "manual"
    });
    return Response.json({ ok: true, usage });
  } catch (error) {
    return mobileApiErrorResponse(error);
  }
}
