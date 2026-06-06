import { Calendar, DollarSign } from "lucide-react";
import type { Player, Playground, Season, Session } from "@/lib/types";

export function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      Amount
      <span className="flex items-center rounded-md border border-line bg-white px-3 shadow-sm">
        <DollarSign className="h-4 w-4 text-slate-400" />
        <input className="min-h-10 w-full bg-transparent px-2 outline-none" min="0" step="0.01" type="number" {...props} />
      </span>
    </label>
  );
}

export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      Date
      <span className="flex items-center rounded-md border border-line bg-white px-3 shadow-sm">
        <Calendar className="h-4 w-4 text-slate-400" />
        <input className="min-h-10 w-full bg-transparent px-2 outline-none" type="date" {...props} />
      </span>
    </label>
  );
}

export function SeasonSelect({
  seasons,
  name = "season_id",
  defaultValue,
  required = true,
  allowCreate = false,
  createLabel = "Create from parsed season"
}: {
  seasons: Season[];
  name?: string;
  defaultValue?: string;
  required?: boolean;
  allowCreate?: boolean;
  createLabel?: string;
}) {
  return (
    <select className="input" defaultValue={defaultValue} name={name} required={required}>
      <option value="">Select season</option>
      {allowCreate ? <option value="__create__">{createLabel}</option> : null}
      {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
    </select>
  );
}

export function PlayerSelect({
  players,
  name = "player_id",
  defaultValue,
  required = true,
  includeIgnore = false,
  emptyLabel = "Select player"
}: {
  players: Player[];
  name?: string;
  defaultValue?: string;
  required?: boolean;
  includeIgnore?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select className="input" defaultValue={defaultValue} name={name} required={required}>
      <option value="">{emptyLabel}</option>
      {includeIgnore ? <option value="__ignore__">Ignore this parsed name</option> : null}
      {players.map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}
    </select>
  );
}

export function PlaygroundSelect({
  playgrounds,
  name = "playground_id",
  defaultValue,
  required = false
}: {
  playgrounds: Playground[];
  name?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <select className="input" defaultValue={defaultValue} name={name} required={required}>
      <option value="">Select playground</option>
      {playgrounds.map((playground) => <option key={playground.id} value={playground.id}>{playground.name}</option>)}
    </select>
  );
}

export function SessionSelect({
  sessions,
  name = "session_id",
  defaultValue,
  required = true,
  allowCreate = false,
  createLabel = "Create from parsed session"
}: {
  sessions: Session[];
  name?: string;
  defaultValue?: string;
  required?: boolean;
  allowCreate?: boolean;
  createLabel?: string;
}) {
  return (
    <select className="input" defaultValue={defaultValue} name={name} required={required}>
      <option value="">Select session</option>
      {allowCreate ? <option value="__create__">{createLabel}</option> : null}
      {sessions.map((session: any) => <option key={session.id} value={session.id}>{session.session_date} {session.name ? `- ${session.name}` : ""} {session.playgrounds?.name ?? session.location ? `- ${session.playgrounds?.name ?? session.location}` : ""}</option>)}
    </select>
  );
}
