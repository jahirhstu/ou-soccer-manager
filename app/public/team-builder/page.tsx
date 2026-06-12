import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PublicSessionRow = {
  id: string;
  session_date: string;
  status: string | null;
};

export default async function PublicTeamBuilderRedirectPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("public_sessions");
  const sessions = ((data ?? []) as PublicSessionRow[]).filter((session) => session.status !== "cancelled");
  const today = currentTorontoDate();
  const upcoming = sessions
    .filter((session) => String(session.session_date) >= today)
    .sort((left, right) => String(left.session_date).localeCompare(String(right.session_date)))[0];
  const fallback = sessions[0];
  const target = upcoming ?? fallback;

  if (!target) redirect("/public/sessions");
  redirect(`/public/sessions/${target.id}/teams`);
}

function currentTorontoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Toronto",
    year: "numeric"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
