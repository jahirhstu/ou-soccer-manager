// These deployment identities are deliberately not supplied by the browser.
export const REFRESH_SOURCE = 'uqntqbcimkyoiptvtrem';
export const REFRESH_TARGET = 'vnmloamscqaqmagimfmz';

export function refreshEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ENABLE_PRODUCTION_REFRESH === 'true'
    && env.APP_ENVIRONMENT === 'development'
    && env.NEXT_PUBLIC_SUPABASE_URL === `https://${REFRESH_TARGET}.supabase.co`;
}

export const refreshTables = [
  'players', 'player_aliases', 'playgrounds', 'seasons', 'sessions', 'payments',
  'attendance', 'dropouts', 'ledger_entries', 'session_player_charges',
  'session_teams', 'session_team_players', 'session_matches', 'session_team_update_events',
  'goals', 'session_team_lineups', 'whatsapp_imports', 'audit_logs', 'leagues',
  'league_teams', 'league_team_players', 'league_matches', 'club_expenses',
  'session_team_builder_drafts', 'player_performance_ratings', 'notifications',
  'club_balance_transfers', 'match_player_positions', 'session_performance_voting',
  'captain_performance_votes', 'performance_changes'
] as const;

export const preservedTables = [
  'profiles', 'organizations', 'organization_members', 'organization_settings',
  'organization_modules', 'programs', 'program_modules', 'program_members',
  'platform_accounts', 'platform_admin_organization_access', 'program_templates',
  'organization_enabled_programs', 'invitations', 'module_catalog', 'program_template_modules',
  'development_refresh_targets', 'development_refresh_jobs'
] as const;

export type RefreshJob = {
  id: string; status: string; created_at: string; error: string | null;
  preview: { table: string; production: number; development: number }[] | null;
  expires_at: string | null;
};
