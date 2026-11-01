import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { localDatabase } from "../../scripts/demo/local-database";

it("reconciles the legacy performance schema without losing its vote, audit, or position data", async () => {
  const db = await localDatabase();
  const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const org = id(1), program = id(2), manager = id(3), player = id(4);
  const season = id(5), session = id(6), teamA = id(7), teamB = id(8), match = id(9);
  try {
    const migrations = readdirSync("supabase/migrations").filter(file =>
      file.endsWith(".sql") && Number(file.split("_")[0]) < 97
    ).sort();
    for (const file of migrations) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }

    await db.exec(`
      insert into auth.users(id,email) values ('${manager}','migration-103@example.test');
      insert into organizations(id,name,slug,public_reports_enabled,onboarding_status)
        values ('${org}','Migration 103','migration-103',true,'active');
      insert into organization_settings(organization_id) values ('${org}');
      insert into organization_members(organization_id,profile_id,role,status)
        values ('${org}','${manager}','owner','active');
      insert into organization_enabled_programs(organization_id,program_template_id)
        select '${org}',id from program_templates where key='soccer';
      insert into programs(id,organization_id,name,slug,activity_type,program_template_id)
        select '${program}','${org}','Soccer','soccer','soccer',id from program_templates where key='soccer';
      select seed_program_modules('${program}');
      insert into program_modules(organization_id,program_id,module_key,enabled)
        values ('${org}','${program}','public_reports',true);
      insert into program_members(organization_id,program_id,profile_id,role,status)
        values ('${org}','${program}','${manager}','manager','active');
      insert into players(id,organization_id,display_name,status)
        values ('${player}','${org}','Legacy Player','active');
      insert into seasons(id,organization_id,program_id,name,start_date,status,price_per_session)
        values ('${season}','${org}','${program}','Season','2020-05-01','active',12);
      insert into sessions(id,organization_id,program_id,season_id,name,session_date,status)
        values ('${session}','${org}','${program}','${season}','Legacy Session','2020-06-03','completed');
      insert into session_teams(id,session_id,name) values
        ('${teamA}','${session}','A'),('${teamB}','${session}','B');
      insert into session_team_players(session_id,session_team_id,player_id)
        values ('${session}','${teamA}','${player}');
      insert into session_matches(id,session_id,match_number,team_a_id,team_b_id)
        values ('${match}','${session}',1,'${teamA}','${teamB}');
    `);

    await db.exec(`
      create table match_player_positions(
        match_id uuid not null references session_matches(id) on delete cascade,
        player_id uuid not null references players(id),
        session_team_id uuid not null references session_teams(id) on delete cascade,
        position text, participated boolean not null default true,
        confirmed_by uuid not null references profiles(id), updated_at timestamptz not null default now(),
        primary key(match_id,player_id)
      );
      create table session_performance_voting(
        session_id uuid primary key references sessions(id) on delete cascade,
        closed boolean not null default false,
        updated_by uuid not null references profiles(id),
        updated_at timestamptz not null default now()
      );
      create table performance_votes(
        session_id uuid not null, team_id uuid not null, category text not null,
        player_id uuid not null, voter_id uuid not null, updated_at timestamptz not null
      );
      create table performance_voting(session_id uuid not null, closed boolean not null);
      create table performance_audit(
        id bigint primary key, session_id uuid not null, actor_id uuid not null,
        action text not null, payload jsonb not null, created_at timestamptz not null
      );
      create view performance_valid_votes as
        select session_id,team_id,category,player_id,voter_id,updated_at from performance_votes;
      insert into performance_votes values
        ('${session}','${teamA}','defender','${player}','${manager}','2020-06-03T12:00:00Z');
      insert into performance_voting values ('${session}',true);
      insert into performance_audit values
        (1,'${session}','${manager}','voting_status','{\"closed\":true}','2020-06-03T12:00:00Z');
      insert into session_performance_voting(session_id,closed,updated_by)
        values ('${session}',false,'${manager}');
      insert into match_player_positions(match_id,player_id,session_team_id,position,confirmed_by)
        values ('${match}','${player}','${teamA}','midfielder','${manager}');
    `);

    await db.exec(readFileSync("supabase/migrations/103_reconcile_performance_migrations.sql", "utf8"));

    const copiedVote = await db.query<{ player_id: string; voter_id: string }>(
      "select player_id,voter_id from captain_performance_votes where session_id=$1 and captain_team_id=$2 and category='defender'",
      [session,teamA]
    );
    expect(copiedVote.rows).toEqual([{ player_id: player, voter_id: manager }]);
    const closeState = await db.query<{ closed: boolean; updated_by: string }>(
      "select closed,updated_by from session_performance_voting where session_id=$1",[session]
    );
    expect(closeState.rows).toEqual([{ closed: true, updated_by: manager }]);
    const archived = await db.query<{ position: string; confirmed_by: string }>(
      "select position,confirmed_by from match_player_positions_legacy_archive where match_id=$1 and player_id=$2",
      [match,player]
    );
    expect(archived.rows).toEqual([{ position: "midfielder", confirmed_by: manager }]);
    expect((await db.query("select 1 from match_player_positions where match_id=$1 and player_id=$2",[match,player])).rows)
      .toHaveLength(0);
    for (const table of ["performance_votes","performance_voting","performance_audit"]) {
      expect((await db.query(`select 1 from ${table} where session_id=$1`,[session])).rows).toHaveLength(1);
    }
    expect((await db.query<{ present: boolean }>(
      "select exists(select 1 from pg_proc where proname='scoped_public_session_performance') present"
    )).rows[0].present).toBe(true);
  } finally {
    await db.close();
  }
}, 60000);
