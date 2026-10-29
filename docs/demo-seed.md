# Development Demo Database

This development-only seed creates a browsable, multi-organization dataset and
real Supabase Auth logins. It does not contact a database until you run it.
Use a **new, disposable development Supabase project**, never production.

For the existing development project, use the separately guarded
[upgrade and cleanup workflow](development-database-upgrade.md) first. After
cleanup, `--use-development-env --confirm=PROJECT_REF:SEED` explicitly selects
the inspected `.env.local` project; without that option this seed still uses
only `.env.seed.local`.

## Run

1. Check out `develop` and install dependencies with `pnpm install`.
2. Create your new Supabase project. Leave its public application schema empty;
   Supabase's built-in Auth schema must already exist.
3. Copy `.env.seed.example` to `.env.seed.local` and fill in the **new project's**
   API URL, server-side secret/service-role key, database connection string, and
   a strong demo password. Use the direct or session-pooler database URL, not
   the transaction pooler. URL-encode special characters in the database password.
4. Run from the repository root:

   ```sh
   pnpm seed:demo --migrate
   ```

   This installs all development migrations in filename order, records their
   versions, creates Auth accounts, and inserts the application dataset.
   If you already installed all migrations through 090 in a fresh database, use
   `pnpm seed:demo` without `--migrate`.
5. Point your **development website's** Supabase environment variables at this
   new project, including its matching client/publishable key and server key.
   Restart the local app or redeploy the development environment. Do not change
   production environment variables or the main branch.
6. Open `seed-demo-manifest.local.json` for login emails, organization/program
   dashboard links, session summaries, and test invitation links.
   Start with `owner@demo.example.test` and your `SEED_USER_PASSWORD`.

Windows PowerShell and Ubuntu/macOS terminals use the same `pnpm` commands.
Copy the example with PowerShell `Copy-Item .env.seed.example .env.seed.local`
or Ubuntu/macOS `cp .env.seed.example .env.seed.local`.
Node.js, pnpm, and network access to the new project's API and PostgreSQL port
are required. The database connection must have migration/admin privileges.

**Do not use the older `pnpm seed` command for this dataset.** That is a separate
legacy script. This script deliberately never loads `.env.local`.
Do not commit `.env.seed.local` or the generated local manifest. Passwords are
not written to the manifest. All demo accounts share the password you provide;
keep the development site isolated and use no real personal information.

## Dataset

- Three demo organizations: Northstar, Riverside, and a suspended organization.
- Eight programs: Northstar soccer, basketball, badminton, cricket, community
  events, training, technical activities; Riverside soccer.
- 50 distinct players, including inactive players, unregistered guests, and two
  different people named Alex Morgan in each active organization.
- 24 seasons, 144 sessions, 360 session fixture matches, and five leagues.
- Each program has previous, current, and upcoming seasons with six sessions
  each. Sports have saved teams, lineups, fixtures, played results, goals,
  assists, own goals, and differing winners. Non-sport programs use attendance
  and finance without fabricated sports matches.
- Completed, scheduled, cancelled, waitlisted, absent, dropped, replacement,
  and unfinished team-builder cases. The previous season includes an overdue
  unfinished session for testing historical cleanup.
- 128 payment notifications, including accepted and unread notifications,
  spread across programs, players, and seasons for pagination/filter testing.
- Confirmed signup imports plus draft and discarded imports, player aliases,
  performance ratings, expenses in all five categories, and audit history.
- Partial/full refunds, signed adjustments, credit and debt carry-forwards,
  host-to-guest transfers, positive/negative club transfers, and reversals.

Dates are relative to the run date. Set `SEED_ANCHOR_DATE` for reproducible dates.
Invitations expire relative to that date; old anchors intentionally produce
expired invitations. Upcoming fixtures have no played results.

Basketball and badminton demonstrate the existing **shared teams/fixtures/score
engine**. This seed does not implement basketball periods or badminton sets.
Template module settings are configured for the demo; the league module is
registered in the catalog. Reserved modules without implemented screens, such
as tasks/RSVP, are not presented as working workflows.

## Login Roles

All addresses use the configured `SEED_EMAIL_DOMAIN`.

| Email prefix | Scenario |
| --- | --- |
| platform-owner | Global platform owner |
| superadmin | Platform administrator assigned to Northstar only |
| owner, admin | Northstar organization owner/admin |
| soccer-manager | Northstar soccer manager only |
| basketball-manager | Northstar basketball manager only |
| captain | Soccer captain linked to Avery Credit |
| member | Soccer member linked to Casey Partial |
| pending, suspended, rejected | Membership access-denial cases |
| outsider | Authenticated but no organization membership |
| other-owner, other-member | Riverside roles and tenant-isolation cases |
| invitee | Invitation acceptance test account |

Cricket is archived. Training's payments module is disabled after data is
created. Technical activity's public reports module is disabled. Riverside
allows public reports but hides public financial details. The suspended
organization has no programs. Migration-created default organization/program
records remain intact but the demo selects Northstar as its default.

## Financial Checks

For Northstar's **Current soccer Season**, expected available credits are:

| Player | Credit | Scenario |
| --- | ---: | --- |
| Avery Credit | $84.00 | $120 paid, three $12 sessions |
| Blake Settled | $0.00 | Exactly paid for played sessions |
| Emery Refund | $64.00 | $20 completed partial refund |
| Finley Forward | $108.00 | Includes $24 carried from previous season |
| Jordan Host | $72.00 | Sent $12 to Kai Guest |
| Logan Waived | $0.00 | All played fees waived |
| Noor Adjustment | $99.50 | $15.50 manual credit |
| Oakley Debit | $78.75 | $5.25 manual debit |
| Taylor Inactive | $72.00 | Inactive, no attendance, still owed credit |
| Uma Refunded | $0.00 | Full $48 refund |

Drew Unpaid owes $36; Casey Partial owes $24. Kai Guest owes $24 after the
host transfer. Badminton has large expenses to exercise club deficits.
Refunds and transfers use the real database functions; original payments and
attendance remain intact. Pending notifications are not receipts.

Read-only verification (use the development database):

```sql
SELECT s.name, p.display_name, v.total_paid_amount, v.total_played_sessions,
       v.credit_amount, v.owes_money
FROM public.player_season_payment_summary v
JOIN public.players p ON p.id = v.player_id
JOIN public.seasons s ON s.id = v.season_id
JOIN public.programs pr ON pr.id = s.program_id
JOIN public.organizations o ON o.id = pr.organization_id
WHERE o.slug = 'northstar-demo' AND pr.slug = 'soccer'
ORDER BY s.start_date, p.display_name;

SELECT s.name, count(*) AS sessions
FROM public.seasons s JOIN public.sessions ss ON ss.season_id = s.id
GROUP BY s.id ORDER BY s.name;
```

## Manual Test Checklist

- Switch organization/program/season; compare reports and public report scope.
- Log in as program managers and attempt cross-program operations; verify denial.
- Try pending/suspended/outsider accounts and invitation acceptance/rejection.
- View saved fixtures, summary shares, standings, goals/assists and team shares.
- Build the unfinished session's teams, enter new results, and inspect reports.
- Accept an unread notification; verify one payment and the changed balance.
- Record a partial refund, then a full refund. Reject an over-credit refund.
- Move credit to another player or a later season in the same program; reject
  cross-program and over-balance moves. Test debt carry-forward separately.
- Transfer a club surplus/deficit and reverse it; verify revenue/expense history
  stays unchanged. Player funds and club funds use separate workflows.
- Review the draft Alex Morgan import; select by identity, not name alone.
- Filter/sort notifications and verify pagination across the larger dataset.

Invalid financial rows are not inserted to simulate failures. Exercise rejected
operations through the UI. Legacy seasonless expenses cannot be newly inserted
under the current constraints. External e-transfer delivery, email delivery,
and every possible error combination are not simulated.

## Safety and Recovery

The seeder refuses existing business data or privileged memberships and never
deletes data. A completed dataset marker makes a repeat run a no-op, preserving
your manual changes. Use another fresh project to start over.

Application data is inserted atomically. Auth API account creation cannot share
that SQL transaction: if insertion fails, demo-owned Auth users may remain.
Fix the reported issue and rerun with the same domain/password. Only accounts
marked as belonging to this dataset are reused; unrelated existing email
addresses are rejected. Reused users' passwords are not reset. Migrations remain
installed if account creation or data insertion fails.

The automated integration test loads the full migration chain and dataset in
an isolated PostgreSQL-compatible PGlite database. It checks counts and financial
results without touching your Supabase project. Run `pnpm test` to repeat it.
