import { parseVoiceScoringCommand, transcribeVoiceScoringAudio } from "@/lib/actions/voice-scoring";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "");
    const sessionId = String(form.get("sessionId") ?? "");
    const action = String(form.get("action") ?? "");
    const { supabase, actor } = await authenticateMobileRequest(request, organizationId);
    requireMobileRole(actor, ["admin", "captain"]);
    const { data: session, error } = await supabase.from("sessions").select("id").eq("id", sessionId).eq("organization_id", actor.organizationId).maybeSingle();
    if (error || !session) throw new Error(error?.message ?? "Session not found.");
    if (action === "transcribe") return Response.json(await transcribeVoiceScoringAudio(form));
    if (action === "parse") return Response.json(await parseVoiceScoringCommand(form));
    return Response.json({ error: "Unsupported voice-scoring action." }, { status: 400 });
  } catch (error) { return mobileApiErrorResponse(error); }
}
