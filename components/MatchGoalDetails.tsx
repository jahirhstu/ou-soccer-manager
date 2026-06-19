export type MatchGoalDetail = {
  scorerName: string | null;
  assistName: string | null;
  goalCount: number | string | null;
};

export function MatchGoalDetails({ goals }: { goals: MatchGoalDetail[] }) {
  const details = goals.flatMap((goal) => {
    const parsedCount = Number(goal.goalCount ?? 1);
    const count = Number.isFinite(parsedCount) ? Math.max(1, Math.floor(parsedCount)) : 1;
    const label = `Scorer: ${goal.scorerName ?? "-"}${goal.assistName ? ` | Assist: ${goal.assistName}` : ""}`;
    return Array.from({ length: count }, () => label);
  });

  if (!details.length) return "-";

  return (
    <div className="grid gap-1">
      {details.map((detail, index) => <div key={`${detail}-${index}`}>{detail}</div>)}
    </div>
  );
}
