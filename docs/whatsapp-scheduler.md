# WhatsApp message scheduler

Communications is an organization-wide admin feature. It uses the existing web app and Supabase project, plus one local Mac worker. No Redis, cloud worker, or paid hosting is needed. Participant/Management mobile screens are not included; shared contracts and scheduling utilities live in `@ou/communications`.

## Deploy the application

1. Apply `supabase/migrations/110_whatsapp_message_scheduler.sql` through the existing reviewed migration process to the intended database, then deploy the web app. Do not apply to production just to run automated tests.
2. Open **Admin → Communications** as an organization owner/admin. Choose **Add weekly signup defaults** to create the supplied template and a **disabled** Monday 21:00 America/Toronto schedule.
3. Under **Connections & History**, provision a worker. Copy its ID and one-time credential into the private local configuration below. Replacing a credential revokes the previous worker and disables automatic messaging.

## Prepare this Mac

Use Node 22 or newer and the repository's pnpm version. From the repository root:

```sh
# The installed Google Chrome will be checked; skip downloading another browser.
PUPPETEER_SKIP_DOWNLOAD=true pnpm install
pnpm whatsapp:build
pnpm whatsapp init
```

Edit `~/Library/Application Support/OU Soccer WhatsApp/config.json` locally:

```json
{
  "supabase_url": "https://YOUR-PROJECT.supabase.co",
  "publishable_key": "YOUR-PUBLISHABLE-OR-ANON-KEY",
  "worker_id": "FROM-DASHBOARD",
  "token": "FROM-DASHBOARD",
  "port": 43821
}
```

The worker credential is scoped to its organization through restricted database RPCs. A Supabase service-role key or database password is **not** needed. Use the intended database's public key. Never paste credentials into a commit, chat, issue, or browser console.

The directory must be mode `0700` and configuration mode `0600`; `init` creates them that way. Optional `chromium_path` selects another installed Chromium browser. `OU_WHATSAPP_HOME` can select another private persistent directory outside the repository; use the same value for all commands. Browser sessions, QR material, execution journals, and logs stay there.

```sh
pnpm whatsapp doctor
pnpm whatsapp install
pnpm whatsapp start
pnpm whatsapp pair
```

`doctor` launches the resolved Puppeteer against Chrome and loads WhatsApp Web, without logging in or sending messages. Installation repeats this check and installs a per-user LaunchAgent. `start` loads it; it will run after future logins and restart on unexpected exit. Keep the checkout and its installed dependencies at the same path; rebuild and reinstall after moving it or changing Node paths.

The pairing page opens on `127.0.0.1`, requires a random token readable only from the private local directory, and expires ten minutes after worker startup. In WhatsApp choose **Linked devices → Link a device** and scan. Use `restart` to renew an expired page. The QR code is never relayed through Supabase. Once paired, normal restarts reuse `LocalAuth`.

## Configure and activate

1. Refresh Connections & History. Confirm **ready**, a recent heartbeat, and compatibility passed. Discovered group names should appear.
2. Edit the weekly schedule, select the actual OU Soccer group, and inspect the exact message preview. The destination is never inferred from its name.
3. Set venue/match-time fields if using their placeholders. Save and enable the schedule.
4. Optionally choose **Send test…**, inspect the resolved message and destination, and confirm the real send. A test is independent of the automatic-send switch and expires after 60 seconds.
5. Explicitly activate **automatic sending** under Connections & History. Both the connection switch and the schedule must be enabled.

The account integration is unofficial; WhatsApp can restrict accounts. There is no detection bypass, bulk recipient feature, or uncertain-send retry.

## Operation

```sh
pnpm whatsapp status
pnpm whatsapp stop
pnpm whatsapp start
pnpm whatsapp restart
pnpm whatsapp pair
```

For a foreground diagnostic session, stop the service first, then run `pnpm --filter @ou/whatsapp-worker start`. A local process lock and a database lease prevent competing workers.

Keep the Mac powered on, logged in, awake, and online. A login LaunchAgent does not run before login, wake a sleeping Mac, or work with a closed laptop lid. Configure macOS energy settings as needed. The worker does not change system power settings. Disconnect in the dashboard disables automation immediately and requests local logout; when offline, the logout request expires after 60 seconds, so stop the worker or repeat the request once online if logout remains necessary.

Heartbeats run about every ten seconds; the dashboard marks them stale after thirty. Group discovery refreshes about once a minute. Network reconnection uses bounded backoff; QR/authentication failures require attention. Logs in the private directory contain events, compatibility results, and execution IDs, not message text or account credentials. `events.log` rotates at 5 MB; launchd captures unexpected errors in `error.log`.

## Timing and delivery semantics

- Local wall time is calculated with Temporal and IANA timezones. Monday 21:00 stays Monday 21:00 through Toronto DST changes.
- Spring-forward nonexistent recurring times are skipped. Fall-back repeated times use the earlier offset. Invalid one-time local times are rejected; previews show the chosen timezone offset.
- Messages are materialized ahead of time and prepared up to sixty seconds early. Dedicated local timers recheck wall time at least every 250 ms before the deadline, independently of group sync and polling.
- A fresh atomic database authorization is required at dispatch. Supabase outages fail closed. An authorized send has a final local deadline check; no provider invocation occurs more than five seconds late.
- Disabling, editing, deleting, or disconnecting is checked at final authorization. A send that already passed authorization may be in progress and cannot be recalled.
- Dispatch intent is durably journaled before calling WhatsApp. Crashes or ambiguous outcomes are **unknown**, never automatically resent. A crash at the invocation boundary may leave dispatch time unavailable. There is no exactly-once delivery guarantee across WhatsApp and PostgreSQL.
- **sent** means WhatsApp server acknowledgement, not recipient delivery/read. History records the first observed acknowledgement and dispatch latency, not guaranteed delivery latency. Reconciled acknowledgement timestamps reflect observation time after recovery.
- A worker that resumes more than five seconds late records **missed**, without catch-up sends. It reconciles occurrences since the last scan; upcoming UI dates do not require a running worker.
- Editing a template does not silently change existing schedules: apply it in the schedule editor and save. The initial signup template is copied verbatim; its fixed venue/time remain literal until changed to placeholders.
- `{{next_sunday_date}}` uses the scheduled execution's timezone/date, strictly advancing to the following Sunday. `{{venue}}` and `{{match_time}}` use schedule fields. Unknown, blank, or malformed variables block sending.

## Checks and verification limits

```sh
pnpm test -- lib/tests/communications.test.ts lib/tests/communications-sql.test.ts lib/tests/communications-provider.test.ts
pnpm --filter @ou/communications typecheck
pnpm --filter @ou/whatsapp-worker typecheck
pnpm whatsapp:build
pnpm build
# Against a configured disposable/local Supabase database:
pnpm test:db
```

Automated tests use a mock WhatsApp provider and an isolated PostgreSQL-compatible PGlite database. `supabase/tests/message_scheduler.sql` adds pgTAP checks for the Supabase suite. No automated test sends real messages.

The implementation-time browser diagnostic passed on Intel macOS 12.7.6, Node 22.23.4, and Chrome 150.0.7871.125. This checks browser launch and page loading, not authenticated WhatsApp compatibility or real dispatch latency. QR pairing, actual delivery, login startup, and sleep/network behavior on a live account must be verified during explicit local setup. Dependency or browser updates require repeating `doctor`.

### Implementation verification — November 17, 2026

- All 36 new scheduling, mock-provider, timer, and database safety tests passed.
- Web/shared-package/worker TypeScript checks and the worker and production web builds passed.
- A headless-browser fixture exercised schedule saving, disabled defaults, resolved test-message confirmation, template and history views, activation confirmation, and a 390px mobile layout. It used mock actions and made no database writes or WhatsApp sends.
- The broader suite had 17 failures across eight existing test files. A clean HEAD baseline had the same 17 failures, with no additional failing test names from this feature; these existing performance/demo/maintenance/refresh failures were left unchanged.
- The actual Supabase pgTAP suite was not run: this checkout has no configured local Supabase CLI/database. The migration was exercised in isolated PGlite tests and loaded successfully in the existing full migration-chain tests.
- No live migration, production deployment, LaunchAgent installation, account pairing, real test send, or automatic-send activation was performed.
