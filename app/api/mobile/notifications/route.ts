import { z } from "zod";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), organizationId: z.string().uuid(), notificationId: z.string().uuid() }),
  z.object({ action: z.literal("submit_payment_sent"), organizationId: z.string().uuid(), playerId: z.string().uuid(), seasonId: z.string().uuid() })
]);

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const { supabase, actor } = await authenticateMobileRequest(request, input.organizationId);
    if (input.action === "accept") {
      requireMobileRole(actor, ["admin"]);
      const { data, error } = await supabase.rpc("accept_notification", { p_notification_id: input.notificationId });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data) throw new Error(String((data as any).error));
      return Response.json({ ok: true, data });
    }
    if (actor.role === "player" && actor.playerId !== input.playerId) throw new Error("Players can only submit their own payment notification.");
    const { data, error } = await supabase.rpc("submit_payment_sent_notification", { p_player_id: input.playerId, p_season_id: input.seasonId });
    if (error) throw new Error(error.message);
    if (data && typeof data === "object" && "error" in data) throw new Error(String((data as any).error));
    return Response.json({ ok: true, data });
  } catch (error) { return mobileApiErrorResponse(error); }
}
