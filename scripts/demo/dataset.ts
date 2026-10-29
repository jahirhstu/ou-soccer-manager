import { createHash } from "node:crypto";

export const DATASET = "multi-program-demo-v1";
export const demoId = (key: string) => {
  const hex = createHash("sha256").update(`${DATASET}:${key}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
export const accounts = ["platform-owner", "superadmin", "owner", "admin", "soccer-manager", "basketball-manager", "captain", "member", "pending", "suspended", "rejected", "outsider", "other-owner", "other-member", "invitee"] as const;
export type AccountKey = typeof accounts[number];
export type AccountIds = Record<AccountKey, string>;
export const playerNames = ["Avery Credit", "Blake Settled", "Casey Partial", "Drew Unpaid", "Emery Refund", "Finley Forward", "Gray Debtor", "Harper Scorer", "Indigo Assist", "Jordan Host", "Kai Guest", "Logan Waived", "Morgan Half Fee", "Noor Adjustment", "Oakley Debit", "Parker Drop In", "Quinn Pending", "Riley Received", "Sam Signup", "Taylor Inactive", "Uma Refunded", "Val Waitlist", "Winter Dropped", "Alex Morgan"];
const sportsModules = ["members","activities","attendance","payments","expenses","teams","scores","fixtures","leaderboards","goals_assists","whatsapp_import","public_reports","leagues"];
const quote = (value: unknown): string => value == null ? "null" : typeof value === "boolean" ? String(value) : typeof value === "number" ? String(value) : `'${(typeof value === "object" ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`;
const identifiers = (columns: string[]) => columns.map(c => `"${c}"`).join(",");

export function buildDemoDataset(userIds: AccountIds, anchor: string, domain = "demo.example.test", invitationToken = "local-demo-invitation") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || Number.isNaN(Date.parse(anchor))) throw new Error("Use an ISO date for the seed anchor.");
  const statements: string[] = [];
  const counts: Record<string, number> = {};
  const insert = (table: string, row: Record<string, unknown>) => {
    if (table === "whatsapp_imports") {
      row = { ...row, parsed_json: {
        rawText: row.raw_text, importType: "session_update", confidence: row.confidence,
        players: [], payments: [], attendance: [], goals: [], dropouts: [], teams: [], matches: [], warnings: [],
        ...(row.parsed_json as Record<string, unknown>)
      } };
    }
    statements.push(`insert into public.${table} (${identifiers(Object.keys(row))}) values (${Object.values(row).map(quote).join(",")});`);
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const day = (offset: number) => new Date(Date.parse(`${anchor}T12:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
  const uuid = (key: string) => quote(demoId(key));
  const owner = userIds["platform-owner"];
  const orgs = ["northstar-demo", "riverside-demo", "paused-demo"];
  const programs = [
    { org: orgs[0], slug: "soccer", template: "soccer", sport: true },
    { org: orgs[0], slug: "basketball", template: "basketball", sport: true },
    { org: orgs[0], slug: "badminton", template: "badminton", sport: true },
    { org: orgs[0], slug: "cricket", template: "cricket", sport: true },
    { org: orgs[0], slug: "community-events", template: "community-event", sport: false },
    { org: orgs[0], slug: "training", template: "training", sport: false },
    { org: orgs[0], slug: "technical-activity", template: "technical-activity", sport: false },
    { org: orgs[1], slug: "soccer", template: "soccer", sport: true }
  ];
  const scenarioLinks: { program: string; season: string; session: string; path: string }[] = [];
  const player = (org: string, n: number) => demoId(`${org}:player:${n}`);
  statements.push(`select set_config('request.jwt.claim.sub', ${quote(owner)}, true);`);
  statements.push("insert into public.module_catalog(key,name) values ('leagues','Leagues') on conflict (key) do nothing;");
  statements.push("update public.organizations set is_default=false where is_default;");
  orgs.forEach((slug, n) => {
    insert("organizations", { id: demoId(slug), name: ["Northstar Demo Club", "Riverside Demo Club", "Paused Demo Club"][n], slug, public_reports_enabled: n !== 2, onboarding_status: n === 2 ? "suspended" : "active", is_default: n === 0 });
    insert("organization_settings", { organization_id: demoId(slug), public_balances_enabled: n === 0, public_payments_enabled: n === 0 });
    for (const module_key of ["programs","members","activities","payments","expenses"]) insert("organization_modules", { organization_id: demoId(slug), module_key, enabled: true });
  });
  for (const key of accounts) statements.push(`update public.profiles set display_name=${quote(`Demo ${key}`)}, role='player', email=${quote(`${key}@${domain}`)} where id=${quote(userIds[key])};`);
  insert("platform_accounts", { profile_id: owner, role: "platform_owner" });
  insert("platform_accounts", { profile_id: userIds.superadmin, role: "platform_superadmin" });
  insert("platform_admin_organization_access", { profile_id: userIds.superadmin, organization_id: demoId(orgs[0]) });
  const memberKeys = accounts.filter(key => !["platform-owner","superadmin","outsider","invitee"].includes(key));
  for (const key of memberKeys) {
    const org = key.startsWith("other-") ? orgs[1] : orgs[0];
    insert("organization_members", { organization_id: demoId(org), profile_id: userIds[key], role: key === "owner" || key === "other-owner" ? "owner" : key === "admin" ? "admin" : "player", status: ["pending","suspended","rejected"].includes(key) ? key : "active" });
  }
  for (const org of orgs.slice(0,2)) {
    for (let n=0;n<24;n++) {
      insert("players", { id: player(org,n), organization_id: demoId(org), display_name: playerNames[n], status: n===19 ? "inactive" : "active", email: `player-${n}@${org}.example.test`, notes: `Synthetic demo player ${n}; ${DATASET}` });
      insert("player_aliases", { player_id: player(org,n), organization_id: demoId(org), alias_name: playerNames[n].split(" ")[0], normalized_alias: playerNames[n].split(" ")[0].toLowerCase(), created_by: owner });
    }
    // Same name, separate identity: exercise explicit player selection.
    insert("players", { id: player(org,24), organization_id: demoId(org), display_name: "Alex Morgan", status: "active", email: `alex-two@${org}.example.test`, notes: "Different person from Alex Morgan #23; never auto-merge by name." });
    insert("playgrounds", { id: demoId(`${org}:venue`), organization_id: demoId(org), name: `${org} Sports Centre`, address: "100 Example Avenue (fictional)" });
  }
  for (const template of ["basketball","badminton"]) {
    counts.program_templates=(counts.program_templates??0)+1;
    statements.push(`insert into public.program_templates(id,key,name,category,default_modules) values (${uuid(`template:${template}`)},${quote(template)},${quote(`${template} Demo`)},'sport',array[${sportsModules.map(quote).join(",")}]);`);
    for (const module_key of sportsModules) statements.push(`insert into public.program_template_modules(program_template_id,module_key,default_enabled,required) values (${uuid(`template:${template}`)},${quote(module_key)},true,${["members","activities"].includes(module_key)});`);
  }
  for (const org of orgs.slice(0,2)) statements.push(`insert into public.organization_enabled_programs(organization_id,program_template_id) select ${uuid(org)},id from public.program_templates;`);
  for (const p of programs) {
    const key=`${p.org}:${p.slug}`, programId=demoId(key), orgId=demoId(p.org);
    statements.push(`insert into public.programs(id,organization_id,program_template_id,name,slug,activity_type,category,is_default) select ${quote(programId)},${quote(orgId)},id,${quote(`${p.slug} Demo`)},${quote(p.slug)},${quote(p.template)},category,${p.slug==="soccer"} from public.program_templates where key=${quote(p.template)};`);
    counts.programs=(counts.programs??0)+1;
    const modules = p.sport ? sportsModules : ["members","activities","attendance","payments","expenses","whatsapp_import","public_reports"];
    // Templates may expose shared modules even where sport-specific screens do not exist.
    for (const module_key of modules) {
      statements.push(`insert into public.program_template_modules(program_template_id,module_key,default_enabled,required) select id,${quote(module_key)},true,false from public.program_templates where key=${quote(p.template)} on conflict do nothing;`);
      insert("program_modules", { organization_id:orgId,program_id:programId,module_key,enabled:true });
    }
    for (let n=0;n<24;n++) if(n!==10 && n!==20) insert("program_members", { organization_id:orgId,program_id:programId,player_id:player(p.org,n),role:n===0?"captain":"member",status:"active" });
    for (const keyName of memberKeys) {
      const isOther=keyName.startsWith("other-");
      if(isOther !== (p.org===orgs[1])) continue;
      if(keyName==="basketball-manager" ? p.slug!=="basketball" : !["owner","admin","other-owner"].includes(keyName) && p.slug!=="soccer") continue;
      const playerIndex=keyName==="captain"?0:keyName==="member"||keyName==="other-member"?2:null;
      insert("program_members", { organization_id:orgId,program_id:programId,profile_id:userIds[keyName],player_id:null,role:keyName.includes("manager")||["owner","admin","other-owner"].includes(keyName)?"manager":keyName==="captain"?"captain":"member",status:["pending","suspended","rejected"].includes(keyName)?keyName:"active" });
      if(playerIndex!==null) {
        // Link the login to the existing player membership; avoid duplicate program/player rows.
        statements.push(`delete from public.program_members where program_id=${quote(programId)} and profile_id=${quote(userIds[keyName])};`);
        statements.push(`update public.program_members set profile_id=${quote(userIds[keyName])},role=${quote(keyName==="captain"?"captain":"member")} where program_id=${quote(programId)} and player_id=${quote(player(p.org,playerIndex))};`);
        statements.push(`update public.organization_members set player_id=${quote(player(p.org,playerIndex))} where organization_id=${quote(orgId)} and profile_id=${quote(userIds[keyName])};`);
        statements.push(`update public.profiles set player_id=${quote(player(p.org,playerIndex))} where id=${quote(userIds[keyName])};`);
      }
      if(p.slug==="soccer"||keyName==="basketball-manager") statements.push(`update public.profiles set default_organization_id=${quote(orgId)},default_program_id=${quote(programId)} where id=${quote(userIds[keyName])};`);
    }
    for (let n=0;n<18;n++) if(p.sport) insert("player_performance_ratings", { organization_id:orgId,program_id:programId,player_id:player(p.org,n),attacking_skill_percent:40+(n*7)%60,defending_skill_percent:35+(n*11)%65,goalkeeping_skill_percent:30+(n*13)%70,created_by:owner,updated_by:owner });
    const seasonIds:string[]=[];
    for(let s=0;s<3;s++) {
      const sk=`${key}:season:${s}`, seasonId=demoId(sk); seasonIds.push(seasonId);
      const start=[-140,-35,60][s], completed=s===0?4:s===1?3:0;
      insert("seasons", { id:seasonId,organization_id:orgId,program_id:programId,name:["Previous","Current","Upcoming"][s]+` ${p.slug} Season`,status:["archived","active","draft"][s],start_date:day(start),end_date:day(start+55),price_per_session:"12.00",total_planned_sessions:6,created_by:owner });
      const payment = (n:number,amount:string,sessionId?:string) => {
        const pk=`${sk}:payment:${n}:${sessionId??"signup"}`;
        insert("payments", { id:demoId(pk),organization_id:orgId,program_id:programId,season_id:seasonId,session_id:sessionId??null,player_id:player(p.org,n),payment_date:day(s===2?-1:start),amount,payment_method:n%2?"cash":"e-transfer",reference_note:`Demo receipt: ${playerNames[n]}`,created_by:owner });
        statements.push(`update public.payments set sessions_covered=amount/12 where id=${uuid(pk)};`);
        insert("ledger_entries", { id:demoId(`${pk}:ledger`),organization_id:orgId,program_id:programId,season_id:seasonId,session_id:sessionId??null,player_id:player(p.org,n),type:"payment_received",amount,description:`Demo receipt: ${demoId(pk)}`,created_by:owner });
        statements.push(`update public.ledger_entries set sessions_count=amount/12 where id=${uuid(`${pk}:ledger`)};`);
      };
      for(const n of [0,1,2,4,5,7,9,13,14,18,19,20]) {
        const amount=n===1?String(completed*12):n===2?"12.00":n===20?"48.00":n===19?"72.00":n===18?"60.00":"120.00";
        if(Number(amount)>0) payment(n,amount);
      }
      const roster=Array.from({length:24},(_,n)=>({name:playerNames[n],matchedPlayerId:player(p.org,n),confidence:"high"}));
      insert("whatsapp_imports", { id:demoId(`${sk}:signup`),organization_id:orgId,program_id:programId,season_id:seasonId,raw_text:`Season Signup\nSeason: ${["Previous","Current","Upcoming"][s]} ${p.slug}\n`+playerNames.map((n,i)=>`${i+1}. ${n}`).join("\n"),parsed_json:{importType:"season_signup",players:roster,payments:[],warnings:[],confidence:"high"},confidence:"high",status:"confirmed",created_by:owner,confirmed_by:owner,confirmed_at:`${day(s===2?-1:start)}T12:00:00Z` });
      for(let j=0;j<6;j++) {
        const sessionKey=`${sk}:session:${j}`, sessionId=demoId(sessionKey), played=j<completed;
        const offset=s===0?start+7*j:s===1?[-28,-21,-7,7,14,21][j]:start+7*j;
        const cancelled=j===5, unbuilt=j===4;
        insert("sessions", { id:sessionId,organization_id:orgId,program_id:programId,season_id:seasonId,playground_id:demoId(`${p.org}:venue`),name:`${p.slug} ${played?"Results":cancelled?"Cancelled":unbuilt?"Draft teams":"Fixture"} ${j+1}`,session_date:day(offset),status:cancelled?"cancelled":played?"completed":"scheduled",start_time:"07:00",end_time:"09:00",price_per_session:"12.00",location:`Court / Field ${(j%3)+1}`,created_by:owner });
        scenarioLinks.push({program:key,season:seasonId,session:sessionId,path:`/${p.org}/${p.slug}/public/sessions/${sessionId}/summary`});
        if(cancelled) continue;
        for(let n=0;n<18;n++) {
          insert("attendance", { id:demoId(`${sessionKey}:attendance:${n}`),organization_id:orgId,program_id:programId,session_id:sessionId,player_id:player(p.org,n),status:played?"played":"confirmed" });
          if(played) {
            const net=n===11?"0.00":n===12?"6.00":"12.00", waived=n===11?"12.00":n===12?"6.00":"0.00";
            const ledgerId=demoId(`${sessionKey}:used:${n}`);
            insert("ledger_entries", { id:ledgerId,organization_id:orgId,program_id:programId,season_id:seasonId,session_id:sessionId,player_id:player(p.org,n),type:"session_used",amount:net,sessions_count:1,description:"Demo played session",created_by:owner });
            insert("session_player_charges", { id:demoId(`${sessionKey}:charge:${n}`),organization_id:orgId,program_id:programId,season_id:seasonId,session_id:sessionId,player_id:player(p.org,n),original_amount:"12.00",waiver_amount:waived,amount:net,waiver_reason:n===11||n===12?"Demo volunteer concession":null,waived_by:n===11||n===12?owner:null,waived_at:n===11||n===12?`${day(offset)}T12:00:00Z`:null,source:"session_completed",ledger_entry_id:ledgerId,created_by:owner });
            if(n===11||n===12) insert("ledger_entries", { organization_id:orgId,program_id:programId,season_id:seasonId,session_id:sessionId,player_id:player(p.org,n),type:"fee_waived",amount:waived,description:"Demo volunteer concession",created_by:owner });
          }
        }
        insert("attendance", { organization_id:orgId,program_id:programId,session_id:sessionId,player_id:player(p.org,21),status:played?"absent":"waitlisted" });
        insert("attendance", { organization_id:orgId,program_id:programId,session_id:sessionId,player_id:player(p.org,22),status:"dropped" });
        insert("dropouts", { organization_id:orgId,program_id:programId,session_id:sessionId,original_player_id:player(p.org,22),replacement_player_id:player(p.org,10),transfer_type:"no_credit",notes:"Demo guest replacement; host funds guest separately",created_by:owner });
        if(played) payment(15,"12.00",sessionId);
        if(!p.sport) continue;
        if(unbuilt) {
          insert("session_team_builder_drafts", { session_id:sessionId,organization_id:orgId,teams:[],players_per_team:6,draft_mode:"balanced",pick_cursor:0,updated_by:owner });
          continue;
        }
        const teams=Array.from({length:3},(_,t)=>demoId(`${sessionKey}:team:${t}`));
        teams.forEach((teamId,t)=>{
          insert("session_teams", { id:teamId,organization_id:orgId,program_id:programId,session_id:sessionId,name:["Falcons","Comets","Waves"][t],label:["A","B","C"][t],captain_player_id:player(p.org,t*6),created_by:owner });
          for(let n=t*6;n<t*6+6;n++) insert("session_team_players", { organization_id:orgId,program_id:programId,session_id:sessionId,session_team_id:teamId,player_id:player(p.org,n),created_by:owner });
          insert("session_team_lineups", { organization_id:orgId,session_id:sessionId,session_team_id:teamId,player_count:6,formation:"2-2-1",positions:Array.from({length:6},(_,n)=>({id:`position-${n}`,label:n===0?"GK":`P${n}`,x:10+n*14,y:30+(n%2)*40,playerId:player(p.org,t*6+n)})),created_by:owner });
        });
        const pairings=[[0,1],[1,2],[2,0],[1,0],[2,1],[0,2]];
        pairings.forEach(([a,b],m)=>{
          const matchId=demoId(`${sessionKey}:match:${m}`);
          insert("session_matches", { id:matchId,organization_id:orgId,program_id:programId,session_id:sessionId,match_number:m+1,display_order:m+1,team_a_id:teams[a],team_b_id:teams[b],away_team_id:teams[b],scheduled_start_time:`${String(7+Math.floor(m*18/60)).padStart(2,"0")}:${String(m*18%60).padStart(2,"0")}`,scheduled_end_time:`${String(7+Math.floor((m+1)*18/60)).padStart(2,"0")}:${String((m+1)*18%60).padStart(2,"0")}`,result_status:played?"played":"scheduled",created_by:owner });
          if(!played) return;
          const winTeam=(s+j)%3;
          const scores=[a===winTeam?3:1,b===winTeam?3:m%2];
          for(const [side,t] of [a,b].entries()) for(let g=0;g<scores[side];g++) {
            insert("goals", { id:demoId(`${sessionKey}:goal:${m}:${side}:${g}`),organization_id:orgId,program_id:programId,session_id:sessionId,match_id:matchId,session_team_id:teams[t],scorer_id:player(p.org,t*6+(g%3)),assist_player_id:g%2?null:player(p.org,t*6+4),goal_count:1,goal_type:"goal",created_by:owner });
          }
          if(m===2) insert("goals", { organization_id:orgId,program_id:programId,session_id:sessionId,match_id:matchId,session_team_id:teams[a],scorer_id:player(p.org,b*6+3),goal_type:"own_goal",goal_count:1,created_by:owner });
          statements.push(`update public.session_matches m set
            team_a_score=(select coalesce(sum(goal_count),0) from public.goals where match_id=m.id and session_team_id=m.team_a_id),
            team_b_score=(select coalesce(sum(goal_count),0) from public.goals where match_id=m.id and session_team_id=m.team_b_id)
            where m.id=${quote(matchId)};`);
        });
      }
      if(completed) {
        for(const [n,amount] of [[13,"15.50"],[14,"-5.25"]] as const) insert("ledger_entries", { organization_id:orgId,program_id:programId,season_id:seasonId,player_id:player(p.org,n),type:"manual_adjustment",amount,description:"Demo signed manual adjustment",created_by:owner });
        for(const n of [2,3,6,10,12,14,16,17]) {
          const notificationId=demoId(`${sk}:notification:${n}`);
          insert("notifications", { id:notificationId,organization_id:orgId,season_id:seasonId,player_id:player(p.org,n),amount:"12.00",message:`${playerNames[n]} sent $12 for ${p.slug}; demo ${s===0?"previous":"current"} season`,created_at:`${day(-n-s*30)}T12:00:00Z` });
          if(n===17) statements.push(`select public.accept_notification(${quote(notificationId)});`);
        }
      }
      for(const category of ["dome_rent","food","jersey","equipment","other"]) insert("club_expenses", { organization_id:orgId,program_id:programId,season_id:seasonId,expense_date:day(s===2?-1:start),category,amount:p.slug==="badminton"?"500.00":"5.00",vendor:"Demo vendor",notes:"Synthetic expense",created_by:owner });
      insert("audit_logs", { organization_id:orgId,actor_id:owner,action:"demo.season.prepared",entity_type:"seasons",entity_id:seasonId,new_data:{dataset:DATASET,program:p.slug} });
    }
    const [previous,current,next]=seasonIds;
    statements.push(`select public.record_player_refund(${quote(player(p.org,4))},${quote(current)},20,${quote(day(-1))},'e-transfer','DEMO-PARTIAL',${uuid(`${key}:refund-partial`)});`);
    statements.push(`select public.record_player_refund(${quote(player(p.org,20))},${quote(current)},48,${quote(day(-1))},'cash',null,${uuid(`${key}:refund-full`)});`);
    statements.push(`select public.carry_forward_player_balance(${quote(player(p.org,5))},${quote(previous)},${quote(current)},24,${quote(day(-1))},'Demo credit carry-forward',${uuid(`${key}:credit-forward`)},'credit');`);
    statements.push(`select public.carry_forward_player_balance(${quote(player(p.org,6))},${quote(previous)},${quote(current)},12,${quote(day(-1))},'Demo debt carry-forward',${uuid(`${key}:debt-forward`)},'debt');`);
    statements.push(`select public.transfer_player_credit(${quote(player(p.org,9))},${quote(player(p.org,10))},${quote(current)},12,${quote(day(-1))},null,'Guest funded by host',${uuid(`${key}:guest-transfer`)});`);
    statements.push(`select public.record_club_balance_transfer(${quote(previous)},${quote(current)},
      (select sign(net_club_balance)*10 from public.admin_dashboard_season_finance(${quote(previous)})),${quote(day(-1))},'Demo signed club transfer',${uuid(`${key}:club-transfer`)});`);
    if(p.slug==="soccer") statements.push(`select public.reverse_club_balance_transfer((select id from public.club_balance_transfers where submission_id=${uuid(`${key}:club-transfer`)}),${uuid(`${key}:club-reversal`)});`);
    insert("whatsapp_imports", { organization_id:orgId,program_id:programId,season_id:next,raw_text:"Session Signup\nPlayers:\n1. Alex Morgan\n2. Kai Guest",parsed_json:{importType:"session_update",players:[{name:"Alex Morgan",confidence:"low"}],warnings:["Two distinct players have this name; choose by identity."]},status:"draft",confidence:"low",created_by:owner });
    insert("whatsapp_imports", { organization_id:orgId,program_id:programId,season_id:current,raw_text:"Discarded demo import",parsed_json:{players:[],payments:[]},status:"discarded",confidence:"medium",created_by:owner });
    if(p.sport) {
      const league=demoId(`${key}:league`), teams=[0,1,2].map(t=>demoId(`${key}:league-team:${t}`));
      insert("leagues", { id:league,organization_id:orgId,program_id:programId,season_id:current,name:`${p.slug} Demo League`,slug:`${p.slug}-demo-league`,status:"active",created_by:owner });
      teams.forEach((id,t)=>{
        insert("league_teams", { id,organization_id:orgId,program_id:programId,league_id:league,name:["Falcons","Comets","Waves"][t],captain_player_id:player(p.org,t*6),seed_order:t+1,created_by:owner });
        for(let n=t*6;n<t*6+6;n++) insert("league_team_players", {organization_id:orgId,program_id:programId,league_id:league,league_team_id:id,player_id:player(p.org,n),created_by:owner});
      });
      for(let m=0;m<6;m++) insert("league_matches", {organization_id:orgId,program_id:programId,league_id:league,round_number:Math.floor(m/3)+1,match_number:m+1,team_a_id:teams[m%3],team_b_id:teams[(m+1)%3],team_a_score:m<3?m+1:null,team_b_score:m<3?1:null,status:m<3?"completed":m===5?"cancelled":"scheduled",scheduled_at:`${day(m<3?-10:10)}T12:00:00Z`,created_by:owner});
    }
  }
  // Archived and disabled-module variants retain data for permission testing.
  statements.push(`update public.program_modules set enabled=false where program_id=${uuid(`${orgs[0]}:training`)} and module_key='payments';`);
  statements.push(`update public.program_modules set enabled=false where program_id=${uuid(`${orgs[0]}:technical-activity`)} and module_key='public_reports';`);
  statements.push(`update public.programs set status='archived' where id=${uuid(`${orgs[0]}:cricket`)};`);
  statements.push(`update public.profiles set default_organization_id=${uuid(orgs[0])},default_program_id=${uuid(`${orgs[0]}:soccer`)} where id in (${quote(owner)},${quote(userIds.superadmin)});`);
  for(const state of ["active","expired","revoked","consumed"]) insert("invitations", {id:demoId(`invitation:${state}`),organization_id:demoId(orgs[0]),program_id:demoId(`${orgs[0]}:soccer`),organization_role:"player",program_role:"member",token_hash:createHash("sha256").update(`${invitationToken}-${state}`).digest("hex"),email:`invitee@${domain}`,expires_at:`${day(state==="expired"?-2:30)}T12:00:00Z`,status:state,used_count:state==="consumed"?1:0,created_by:owner});
  insert("audit_logs", {id:demoId("complete"),organization_id:demoId(orgs[0]),actor_id:owner,action:"demo.seed.completed",entity_type:"demo_dataset",new_data:{dataset:DATASET,anchor,counts}});
  return { sql: statements.join("\n"), counts, programs, scenarioLinks, anchor, invitationTokens:Object.fromEntries(["active","expired","revoked","consumed"].map(state=>[state,`${invitationToken}-${state}`])) };
}
