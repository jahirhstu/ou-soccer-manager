import { notFound } from "next/navigation";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { money } from "@/lib/utils";

type PublicSessionDetail = {
  session?: {
    id: string;
    name: string | null;
    sessionDate: string;
    seasonName: string | null;
    playgroundName: string | null;
    location: string | null;
    pricePerSession: number | string | null;
    status: string | null;
  } | null;
  teams?: Array<{
    id: string;
    name: string;
    captainName: string | null;
    players: string[];
  }>;
  matches?: MatchRow[];
  attendance?: Array<{
    playerName: string | null;
    status: string;
    notes: string | null;
  }>;
  goals?: Array<{
    goalType: "goal" | "own_goal" | null;
    scorerName: string | null;
    assistName: string | null;
    teamName: string | null;
    goalCount: number | string | null;
  }>;
};

export default async function PublicSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_session_detail", { p_session_id: id }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");

  if (!error && !data) notFound();

  const detail = (data ?? {}) as PublicSessionDetail;
  const session = detail.session;
  const matches = detail.matches ?? [];

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-6">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public session details are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <section className="panel p-5">
          <h1 className="page-title">{session?.name ?? session?.sessionDate ?? "Session"}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {session?.name ? <span>{session.sessionDate}</span> : null}
            <span>{session?.seasonName ?? "-"}</span>
            <span>{session?.playgroundName ?? session?.location ?? "-"}</span>
            <span>{session?.pricePerSession == null ? "Season default price" : `${money(numberValue(session.pricePerSession))} session price`}</span>
            {session?.status ? <StatusBadge status={session.status} /> : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn-primary" href={`/public/sessions/${id}/scores`}>Game scores</Link>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Game scores</h2>
          <DataTable
            rows={matches}
            columns={[
              { header: "Game", cell: (row) => row.matchNumber },
              { header: "Result", cell: (row) => `${row.teamAName ?? "-"} ${row.teamAScore ?? 0}-${row.teamBScore ?? 0} ${row.teamBName ?? "-"}` }
            ]}
          />
        </section>
      </div>
    </PublicShell>
  );
}

type MatchRow = {
  matchNumber: number;
  teamAName: string | null;
  teamBName: string | null;
  teamAScore: number | string | null;
  teamBScore: number | string | null;
};

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
