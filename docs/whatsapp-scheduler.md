# Set up automatic WhatsApp messages on your Mac

Follow these steps in order. Run **Terminal** commands on the Mac that will send the messages. Run **SQL** only in the intended Supabase project's SQL Editor. Steps labelled **Website** happen in OU Soccer Manager; steps labelled **Vercel** happen in its hosting dashboard.

**Your goal:** post the weekly signup announcement every Monday at **9:00 PM, America/Toronto**, using your personal WhatsApp account.

The walkthrough configures the existing application. You do not need a new database, Supabase CLI, Docker, Redis, Meta developer account, WhatsApp Business API, or paid worker server. This is an unofficial WhatsApp Web integration; WhatsApp may restrict accounts using it.

For a high-level diagram and explanation of the components and message flow, see [WhatsApp scheduler architecture](whatsapp-scheduler-architecture.md).

## Before you start

Have these available:

- The Mac that will stay on, with its power adapter connected and Google Chrome installed.
- Your phone, signed in to the WhatsApp account that belongs to the soccer group.
- An owner/admin login for the correct organization in OU Soccer Manager.
- Access to the existing Supabase project and Vercel project.
- The repository on this Mac, including the WhatsApp scheduler changes.

If this is a repeat setup and automatic sending is already on, turn it off under **Communications → Connections & History** before changing the worker configuration. Keep it off until Step 12.

| Part | Where it runs | What it does |
|---|---|---|
| OU Soccer Manager dashboard | Vercel | Lets you manage templates, groups, schedules, and history |
| Database and app authentication | Supabase | Stores configuration and execution records; checks permissions |
| WhatsApp worker | Your Mac | Keeps WhatsApp connected and sends at the scheduled time |
| Linked-device authentication | Your phone + local Mac pairing page | Connects your personal WhatsApp account |

The Mac worker runs independently of the website. You do **not** need to keep the website open or run `next dev` on the Mac after setup. The Mac must remain logged in, awake, powered on, and connected to the internet.

## Step 1 — Identify the website and its Supabase project

**Where: Vercel and Supabase in your browser.**

1. Open the Vercel project for OU Soccer Manager.
2. Choose the deployment you intend to use: the public production site or a development/preview site. Record its website URL privately.
3. In **Settings → Environment Variables**, find `NEXT_PUBLIC_SUPABASE_URL` for that deployment's environment. A `develop` branch deployment may use **Preview** variables; do not assume it uses Production variables.
4. Open the Supabase project whose URL matches that value. Its URL usually looks like `https://PROJECT-REFERENCE.supabase.co`.
5. Use this same project for every database step and for the Mac worker's configuration.

**Success:** you know which website and database belong together. Do not create another Supabase project or connect a development worker to a different production database by accident.

You can write down the website URL and Supabase project name/reference. Do not put secret keys or worker tokens in a shared document.

## Step 2 — Prepare Terminal, Node.js, and Chrome

**Where: Terminal on your Mac.**

Open **Applications → Utilities → Terminal**, or press **Command + Space**, type **Terminal**, and press Return.

Enter the repository directory:

```sh
cd /Users/jahir/Works/Codebase/ou-soccer-manager
```

Confirm you are in the correct place:

```sh
pwd
```

**Expected:** `/Users/jahir/Works/Codebase/ou-soccer-manager`. If the checkout has moved, use its actual folder instead throughout this guide.

Check the installed tools:

```sh
node --version
```

```sh
npm --version
```

```sh
npx --version
```

This Mac previously had **Node v22.23.4**. If Node is available at that version, keep it. For another installation, use **Node 22.13 or newer on the 22.x line** for this walkthrough. If `node`, `npm`, or `npx` is missing, install the macOS installer from the [official Node 22 release page](https://nodejs.org/en/blog/release/v22.23.4), then close and reopen Terminal and repeat the checks. The release page includes a macOS `.pkg` installer; you do not need Homebrew for this route.

Check Chrome:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
```

**Expected:** a Google Chrome version. If Chrome is missing, install it from [Google Chrome](https://www.google.com/chrome/) into Applications. If your macOS version cannot run a supported browser, the compatibility check in Step 9 must pass before continuing; installing Node alone does not resolve browser incompatibility.

## Step 3 — Use the correct package manager

**Where: Terminal, still in the repository directory.**

This is a **pnpm workspace**, so do not use `npm install`. npm cannot resolve the application's `workspace:*` dependencies.

This guide uses `npx` to run the exact pnpm version without requiring a global pnpm installation:

```sh
npx --yes pnpm@11.9.0 --version
```

**Expected:** `11.9.0`. The first command may download pnpm and take a little longer. Internet access to the npm registry is needed.

Install the repository dependencies:

```sh
PUPPETEER_SKIP_DOWNLOAD=true npx --yes pnpm@11.9.0 install --frozen-lockfile
```

**Expected:** installation finishes successfully. This uses the committed lockfile and the installed Chrome instead of downloading another browser. If the lockfile is reported outdated, stop and reconcile the checkout/lockfile; do not bypass the check by switching to npm.

Build the local worker:

```sh
npx --yes pnpm@11.9.0 whatsapp:build
```

Confirm its files exist:

```sh
ls apps/whatsapp-worker/dist/cli.js apps/whatsapp-worker/dist/main.js
```

**Expected:** both filenames are listed. This prepares the worker but does not install a background service or send messages.

## Step 4 — Check whether migration 110 is already installed

**Where: Supabase → the project selected in Step 1 → SQL Editor → New query.**

Run this **read-only** query:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'message_templates',
    'message_schedules',
    'message_destinations',
    'message_executions',
    'message_worker_connections',
    'message_worker_commands',
    'message_worker_heartbeats'
  )
order by tablename;
```

Then run:

```sql
select
  to_regprocedure('public.message_admin(uuid,text,jsonb)') is not null
    as admin_function_exists,
  to_regprocedure('public.message_worker(uuid,text,uuid,text,jsonb)') is not null
    as worker_function_exists;
```

Interpret the results:

| Result | Next action |
|---|---|
| Seven tables, every `rowsecurity` value is `true`, and both functions are `true` | The main objects are present. Check policies below, then continue to Step 5; do not rerun migration 110. |
| No matching tables and both functions are `false` | Migration 110 has not been installed. Follow the installation instructions below. |
| Only some objects exist, RLS is false, or a function is missing | Stop here. The setup may be partial; inspect the migration error before rerunning or dropping anything. |

Check the policies too:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'message_templates', 'message_schedules', 'message_destinations',
    'message_executions', 'message_worker_connections',
    'message_worker_commands', 'message_worker_heartbeats'
  )
order by tablename, policyname;
```

**Expected:** 10 policies: `admin_read` on six tables, plus `admin_insert` and `admin_update` on each of `message_templates` and `message_schedules`. `message_worker_connections` deliberately has no client policy; its credential hashes are accessible only through restricted functions, not direct client reads. These checks confirm the expected objects, not a complete security audit.

### If migration 110 has not been installed

This assumes the existing application's earlier migrations have already been applied. If Supabase reports missing organizations or authorization functions, stop and reconcile the earlier migrations instead of creating replacement tables manually.

1. Confirm again that SQL Editor is in the intended project. Use your normal database backup/release process for a live database.
2. Open [migration 110](../supabase/migrations/110_whatsapp_message_scheduler.sql) in the repository.
3. Copy the **entire file**, paste it into one new SQL Editor query, and run it together.
4. Wait for a successful result, then repeat the read-only checks above.

SQL Editor may warn about an update without `WHERE` or tables without RLS. In this exact migration, the ordinary updates have filters, conflict updates apply only to matching rows, and the `DO` block enables RLS dynamically on all seven tables. The scanner may not recognize those patterns. Do not omit the RLS block or run only the table-creation section.

If you applied the file manually in SQL Editor, it may not appear in the Supabase CLI's migration history. Keep a record of the manual application; reconcile history before a future CLI migration push so it does not attempt to recreate these objects.

Do **not** run database reset, cleanup, or seed commands to set up messaging. Existing players, seasons, and payments should remain intact.

### Install migration 111 for efficient coordination

The optimized worker also requires [migration 111](../supabase/migrations/111_efficient_whatsapp_coordination.sql), after migration 110. Check its main functions with this read-only query:

```sql
select
  to_regprocedure('public.message_worker_coordinate(uuid,text,uuid,jsonb)') is not null as coordination_exists,
  to_regprocedure('public.message_worker_materialize_batch(uuid,text,uuid,jsonb)') is not null as batching_exists;
```

If both are false, apply the complete migration 111 file to the intended project through your migration/release process. If both are true, do not rerun it. For a partial result, inspect the existing schema before proceeding.

For an existing installation, apply migration 111 first, deploy the updated website second, and only then rebuild/restart the Mac worker. Existing workers continue using their old API during this transition. Production and development databases each need their own migration. No credentials, schedules, or activation settings need to be replaced.

## Step 5 — Configure and deploy the website on Vercel

**Where: Vercel project settings.**

Under **Build and Deployment** (the exact grouping can vary), use these settings:

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root Directory | Repository root, not `apps/whatsapp-worker` |
| Install Command override | `npx --yes pnpm@11.9.0 install --frozen-lockfile` |
| Build Command override | `npx --yes pnpm@11.9.0 run build` |
| Node.js version | 22.x |

Remove any `npm install` override. An override can force npm even when Vercel detects the pnpm lockfile. See [Vercel package managers](https://vercel.com/docs/package-managers) and [configuration overrides](https://vercel.com/docs/project-configuration/vercel-json).

Under **Environment Variables**, confirm the chosen deployment environment has:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's publishable key, or its legacy anon key |

The existing app also supports `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a fallback. If both key variables exist, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` takes precedence; make sure it is not an old key for another project. Preserve unrelated variables already required by the app.

Save and redeploy the branch containing the scheduler changes. Environment changes require a new deployment. A successful build should get past dependency installation and show the `/communications` route in the Next.js build output.

**Success:** the deployed website opens, your existing owner/admin login works, and the correct organization has **Admin → Communications**.

If authentication already works, no new Supabase Auth provider or WhatsApp OAuth configuration is required. Supabase authenticates dashboard users; QR scanning authenticates WhatsApp separately. Existing email-link authentication should retain the website's correct Supabase Auth Site URL and allowed redirect URLs.

You do not need to add the worker token to Vercel, host the worker on Vercel, configure Vercel Cron, or expose your Mac to the internet.

## Step 6 — Get the Supabase URL and public key

**Where: the same Supabase project → Connect dialog, or Project Settings → API Keys / Data API.**

Copy the project URL and **publishable key**. Older projects may show a legacy **anon** key instead; that is supported. Supabase describes these locations in its [API key guide](https://supabase.com/docs/guides/getting-started/api-keys).

You will fill in these four values shortly:

| Local configuration field | Where to obtain it | Meaning |
|---|---|---|
| `supabase_url` | Supabase project URL | Database/API project used by the website |
| `publishable_key` | Supabase publishable key or legacy anon key | Public API key; not the worker credential |
| `worker_id` | Website's **Provision worker…** result in Step 7 | Identifier for this organization's Mac worker |
| `token` | The same provisioning result | Private worker credential, displayed once |

Do not use a Supabase `service_role` key, `sb_secret_...` key, PostgreSQL password, or database connection string in this configuration. They are not needed. The worker token is also different from your WhatsApp login/session.

## Step 7 — Provision the worker in the website

**Where: OU Soccer Manager in your browser.**

1. Sign in as an organization owner/admin and select the correct organization.
2. Open **Admin → Communications → Connections & History**.
3. Check that **Automatic sending OFF** is displayed. If it is on, disable it first.
4. Click **Provision worker…**, read the confirmation, then click **Confirm**.
5. Keep the one-time credential result open until you finish Step 8. It contains `worker_id` and `token`.

If the button says **Replace credential…**, a worker has already been provisioned. Reuse the current private local configuration if it is valid. Replace only when needed: replacing revokes the previous worker credential and disables automation. After replacement, the Mac configuration must be updated and the worker restarted.

**Success:** you have one worker ID and its matching token from the intended organization. Do not share, screenshot, or commit the token.

## Step 8 — Create and fill in the Mac configuration

**Where: Terminal on the sending Mac, in the repository directory.**

Create the private configuration file:

```sh
npx --yes pnpm@11.9.0 whatsapp init
```

**Expected:** a message asking you to edit:

```text
~/Library/Application Support/OU Soccer WhatsApp/config.json
```

If it says the configuration already exists, keep it and open it instead of deleting it or rerunning initialization.

Open the file:

```sh
open -e "$HOME/Library/Application Support/OU Soccer WhatsApp/config.json"
```

In TextEdit, preserve **plain text**. If necessary, choose **Format → Make Plain Text**. Disable Smart Quotes under **Edit → Substitutions** while editing JSON, and use straight double quotes as shown below.

Replace the placeholder values with your own values from Steps 6 and 7:

```json
{
  "supabase_url": "https://YOUR-PROJECT.supabase.co",
  "publishable_key": "YOUR-PUBLISHABLE-OR-ANON-KEY",
  "worker_id": "YOUR-WORKER-ID-FROM-THE-WEBSITE",
  "token": "YOUR-WORKER-TOKEN-FROM-THE-WEBSITE",
  "port": 43821
}
```

Do not paste the two-field provisioning result over the whole file; you still need the URL, public key, and port. Keep commas between fields and no comma after the last field. Save with **Command + S**; the filename must remain `config.json`, not `config.json.txt` or `.rtf`.

Verify the JSON syntax without printing its contents:

```sh
node -e 'const fs=require("node:fs"),os=require("node:os"),path=require("node:path"); try { JSON.parse(fs.readFileSync(path.join(os.homedir(),"Library/Application Support/OU Soccer WhatsApp/config.json"),"utf8")); console.log("JSON syntax OK"); } catch { console.error("Cannot read valid JSON; check the private file in TextEdit."); process.exitCode=1; }'
```

**Expected:** `JSON syntax OK`. This checks syntax only; the next step checks required values and formats. Do not share raw JSON parser errors, which may quote part of your private file.

Set the required permissions:

```sh
chmod 700 "$HOME/Library/Application Support/OU Soccer WhatsApp"
```

```sh
chmod 600 "$HOME/Library/Application Support/OU Soccer WhatsApp/config.json"
```

Check permissions without reading the token:

```sh
stat -f '%Lp %N' "$HOME/Library/Application Support/OU Soccer WhatsApp" "$HOME/Library/Application Support/OU Soccer WhatsApp/config.json"
```

**Expected:** the directory shows `700`; the file shows `600`.

The worker does not read these values from the repository's `.env.local`. This guide uses the default private directory; do not set `OU_WHATSAPP_HOME` for these commands. Credentials and the WhatsApp session stay outside the repository.

## Step 9 — Verify that this Mac can run WhatsApp Web

**Where: Terminal.**

```sh
npx --yes pnpm@11.9.0 whatsapp doctor
```

**Expected:** JSON containing a browser version, Node version, `"platform": "darwin"`, and the Mac architecture (`x64` or `arm64`).

This starts headless Chrome and loads WhatsApp Web. It does not pair your account or send a message. A passing result establishes browser launch/page-loading compatibility; the account must still reach `ready` after pairing.

If it fails, stop here and use the troubleshooting section. Common causes are a missing/incompatible Chrome binary, network filtering, or invalid configuration. Do not activate automatic sending while compatibility fails.

## Step 10 — Install and start the Mac background service

**Where: Terminal.**

Install the login service:

```sh
npx --yes pnpm@11.9.0 whatsapp install
```

**Expected:** an installation message referring to:

```text
~/Library/LaunchAgents/app.ou-soccer.whatsapp.plist
```

This repeats the compatibility check and writes the service configuration. It does **not** start the service yet.

Start it:

```sh
npx --yes pnpm@11.9.0 whatsapp start
```

**Expected:** the command exits successfully; it may print no additional text.

Check it:

```sh
npx --yes pnpm@11.9.0 whatsapp status
```

**Expected:** launchd service details, including a running process/PID. `status` confirms the process exists; the dashboard confirms whether WhatsApp is connected.

After it is loaded, the service is configured to run after future Mac logins and restart after unexpected exits. You can close Terminal after setup. Do not move the repository or delete its `node_modules`/worker build while the service uses it. Installation records absolute paths for Node and the worker.

If `start` says the service is already loaded, use `status` or `restart` rather than loading a second copy. Do not run a foreground worker alongside this service.

## Step 11 — Pair your personal WhatsApp account

**Where: Terminal, the local page on the Mac, and WhatsApp on your phone.**

Open the pairing page on this Mac:

```sh
npx --yes pnpm@11.9.0 whatsapp pair
```

**Expected:** a browser page titled **WhatsApp pairing**, eventually showing a QR code and `qr_required`.

On your phone:

1. Open WhatsApp.
2. Open **Settings → Linked Devices** on iPhone, or the menu **⋮ → Linked devices** on Android.
3. Choose **Link a device**, unlock if asked, and scan the QR displayed on the Mac.
4. Wait for the local page to show `ready`.

The page refreshes every five seconds. If it shows `starting` or no code, let it refresh. On slower first-time loads, WhatsApp initialization can take up to two minutes after the browser starts. A service restart can also require about thirty seconds for the previous database lease to expire. If initialization fails, the local page shows a connection issue and `events.log` records a safe diagnostic category such as `initialization_timeout`; QR contents and session data are not logged. Its local access link expires ten minutes after worker startup. To renew it, run these commands separately, wait for the worker to start, and scan again:

```sh
npx --yes pnpm@11.9.0 whatsapp restart
```

```sh
npx --yes pnpm@11.9.0 whatsapp pair
```

Do not type just `http://127.0.0.1:43821` into the browser: the `pair` command opens the required private tokenized URL. The page must be opened on the Mac, not on the phone. The phone scans the code; it does not visit the URL.

Return to **Website → Communications → Connections & History** and click **Refresh**. Allow roughly a minute for initial connection/group discovery. After startup, automatic group discovery runs every fifteen minutes; use **Refresh WhatsApp groups** to request it sooner.

**Success:** all of the following are true:

- State is `ready`.
- Compatibility shows `passed`.
- Heartbeat is recent; it normally updates about every thirty seconds.
- Your WhatsApp groups appear under **Available groups**.
- Automatic sending is still **OFF**.

If your soccer group is missing, confirm that you paired the correct personal account and that the account is a member of the group. The session remains in the Mac's private directory across normal restarts; repeat pairing only if authentication is lost or you explicitly logged out.

## Step 12 — Send one confirmed test, then activate the weekly schedule

**Where: OU Soccer Manager, with WhatsApp available to verify the result.**

### First, use a private test group

1. Create or choose a private WhatsApp group containing only people who expect your test message. The connected account must be a member and have permission to post.
2. Choose **Refresh WhatsApp groups** in Connections & History, allow up to thirty seconds for the request to reach the worker, then refresh the dashboard.
3. Open **Communications → Schedules → New schedule**.
4. Enter the name `WhatsApp connection test` and message `OU Soccer WhatsApp setup test — please ignore.`
5. Select the private test group.
6. Leave **Enable schedule** unchecked. Set a future schedule time so the form remains usable; it will not run automatically while disabled.
7. Review the preview and click **Send test…**.
8. Read the confirmation's destination and exact message. Click **Confirm** only when they are correct.
9. Open **Connections & History** and refresh. Check the result and the actual message in WhatsApp.

**Expected:** a single test message in that group, and a `sent` history entry with dispatch time, acknowledgement time, and latency. A test can send while automatic sending is OFF; it is a deliberate, separately confirmed action. If unprocessed for 60 seconds, it expires.

If it shows `unknown`, check the group before taking further action. Do not repeatedly click Send test to resolve uncertainty. Delete the disabled test schedule when finished; history remains.

### Then configure the real weekly signup

1. Under **Schedules**, choose **Add weekly signup defaults**. If the default already exists, edit it instead.
2. Click **Edit / preview** on **OU Soccer Weekly Signup**.
3. Verify these fields:

| Field | Value |
|---|---|
| Name | OU Soccer Weekly Signup |
| WhatsApp group | Your actual OU Soccer group, selected from discovered groups |
| Frequency | Weekly |
| Weekdays | Monday only |
| Local time | `21:00:00` / 9:00:00 PM |
| Timezone | `America/Toronto` |
| Venue | Bell Sensplex, or the venue you intend to use |
| Match time | 7 AM – 9 AM, or the time you intend to use |

4. Review the full announcement and its preview date. `{{next_sunday_date}}` should resolve to the Sunday after the scheduled Monday. The preview shows the timezone offset; DST is handled automatically.
5. The supplied announcement has a literal venue and `7 AM – 9 AM` in its body. Changing the schedule fields alone will not replace those literal lines. Edit the message itself or use `{{venue}}` and `{{match_time}}` where you want those fields inserted.
6. Check **Enable schedule** and choose **Save schedule**. Confirm the upcoming dates are Mondays at 9 PM Toronto time. Configure this at least a minute before its first intended execution so the worker has time to prepare it.
7. Open **Connections & History** and confirm the worker is still `ready` with a recent heartbeat.
8. Choose **Activate automatic sending…**, review the confirmation, and click **Confirm**.

**Success:** the weekly schedule is **Enabled** and **Automatic sending ON** is displayed. Both switches must be on. Group names are not matched automatically: confirm the exact destination in the schedule.

From now on, enabled schedules can send without another confirmation. To pause them, disable automatic sending or disable the individual schedule.

## Step 13 — Keep the Mac ready for Monday at 9 PM

**Where: macOS settings on the sending Mac.**

1. Keep the power adapter connected. For a laptop, keep the lid open.
2. Keep the Mac logged in. Locking the screen is different from logging out; a screen lock does not itself stop the worker, but system sleep does.
3. Set date/time automatically. On macOS Monterey, look under **Apple menu → System Preferences → Date & Time**. On newer macOS, use **System Settings → General → Date & Time**. Set the local timezone appropriately; the schedule itself must still explicitly say `America/Toronto`.
4. Prevent idle system sleep while plugged in. On Monterey notebooks, look in **System Preferences → Battery → Power Adapter** for the option to prevent automatic sleep when the display is off. Desktop Macs may show **Energy Saver**. On newer versions, look in **System Settings → Battery → Options** or **Energy**. Names depend on the Mac model/version; [Apple's sleep guidance](https://support.apple.com/en-ie/guide/mac-help/mchlp2995/mac) explains the available settings.
5. Keep internet access available to both Supabase and WhatsApp Web. No inbound router ports, public tunnel, firewall exception for public access, or port forwarding is needed for the local pairing page.
6. Several minutes before the first Monday run, refresh the dashboard and verify the checklist below.

For a temporary session, you can also keep a separate Terminal window open with this built-in macOS command:

```sh
caffeinate -i
```

It prevents idle system sleep while the command runs. Press **Control + C** to end it. It does not wake a sleeping Mac, override closing the laptop lid, or replace the power/login requirements. Choose persistent macOS settings for unattended weekly use.

### Ready-to-send checklist

- [ ] The website and Mac worker use the same intended Supabase project.
- [ ] Worker is `ready`, compatibility passed, and heartbeat is recent.
- [ ] The private-group test appeared in WhatsApp and was recorded in history.
- [ ] The actual OU Soccer destination and announcement have been reviewed.
- [ ] Schedule is Enabled: Monday, 21:00:00, America/Toronto.
- [ ] Automatic sending is ON; no other unwanted schedules are enabled.
- [ ] The Mac is powered on, logged in, awake, online, and the laptop lid is open.

If the Mac resumes more than five seconds after the scheduled time, the execution is marked **missed**. There is no automatic catch-up send. Exact WhatsApp delivery time is not guaranteed; the application measures when it invokes sending and when it observes acknowledgement.

## Everyday commands

**Where: Terminal, after `cd /Users/jahir/Works/Codebase/ou-soccer-manager`.**

| Task | Command |
|---|---|
| Check background service | `npx --yes pnpm@11.9.0 whatsapp status` |
| Stop background service | `npx --yes pnpm@11.9.0 whatsapp stop` |
| Start it after stopping | `npx --yes pnpm@11.9.0 whatsapp start` |
| Restart it | `npx --yes pnpm@11.9.0 whatsapp restart` |
| Open the local pairing page | `npx --yes pnpm@11.9.0 whatsapp pair` |
| Check browser compatibility | `npx --yes pnpm@11.9.0 whatsapp doctor` |

Stopping the Mac service does not change the dashboard's automatic-send switch. Disable that switch too if you want messaging to remain off when the worker starts again.

**Disconnect…** in the dashboard disables automation and requests WhatsApp logout. If the worker is offline, the logout request expires after 60 seconds; stop it locally or repeat the request once online if logout is still needed. Restarting normally preserves the session; disconnecting/logging out may require QR pairing again.

### View recent logs

These commands show operational logs, not the private configuration:

```sh
tail -n 50 "$HOME/Library/Application Support/OU Soccer WhatsApp/events.log"
```

```sh
tail -n 50 "$HOME/Library/Application Support/OU Soccer WhatsApp/error.log"
```

For a live view:

```sh
tail -f "$HOME/Library/Application Support/OU Soccer WhatsApp/events.log"
```

Press **Control + C** to stop watching; this does not stop the worker. `events.log` rotates at 5 MB. `error.log` captures unexpected service errors. If a log file does not exist yet, the worker may not have reached the point that creates it.

### After updating worker code or changing paths

Stop the service before replacing its build:

```sh
npx --yes pnpm@11.9.0 whatsapp stop
```

After updating the checkout through your normal Git workflow, install dependencies and rebuild:

```sh
PUPPETEER_SKIP_DOWNLOAD=true npx --yes pnpm@11.9.0 install --frozen-lockfile
```

```sh
npx --yes pnpm@11.9.0 whatsapp:build
```

```sh
npx --yes pnpm@11.9.0 whatsapp doctor
```

```sh
npx --yes pnpm@11.9.0 whatsapp install
```

```sh
npx --yes pnpm@11.9.0 whatsapp start
```

Reinstallation refreshes absolute paths if Node or the checkout moved. Check `ready` and the heartbeat again. If the automatic-send switch was already on, the worker can resume enabled schedules after restart; turn it off first when doing maintenance near a scheduled time.

## Troubleshooting

### `pnpm: command not found`

Use the complete `npx --yes pnpm@11.9.0 ...` commands in this guide. A global pnpm installation is not required. If `npx` is missing too, finish Step 2 and reopen Terminal.

### `Unsupported URL Type "workspace:"`

The install used npm. Locally, use Step 3's pnpm installation command. On Vercel, replace the Install Command override with the one in Step 5 and redeploy. The unrelated npm `cache-dir` warning is not the cause.

### `Cannot find module .../dist/cli.js` or missing worker build

Return to the repository root and run Step 3's dependency-install and `whatsapp:build` commands. Do not start from inside `apps/participant`, `apps/management`, or another folder.

### Configuration already exists

This is expected on repeat setup. Open it with Step 8's TextEdit command. Do not replace a working token just to rerun initialization.

### `Invalid config.json`, `Invalid worker configuration`, or a JSON parsing error

Check straight quotes, commas, filename, and plain-text format. Replace every placeholder. `worker_id` must be the UUID shown by the website; `token` must be its matching 64-character hexadecimal token. The Supabase URL must start with `https://`; do not enter the SQL database connection string. Do not post your private file to troubleshoot it.

### Permissions must be `0700` or `0600`

Run Step 8's two `chmod` commands and its `stat` check. Run the worker as your normal logged-in Mac user; do not use `sudo` to start it.

### Missing table, missing `message_admin` / `message_worker`, or schema-cache errors

Repeat Step 4 in the same project used by the website. If SQL objects are present but the website still reports missing objects, first confirm the deployed environment variables and redeploy after changes. If the project matches and the new objects are present, inspect the Supabase API/schema-cache state; do not delete tables or repeatedly rerun the creation script.

### Organization administrator required / Communications is missing

Use an organization owner/admin account and select the correct organization. Program-level management permission alone may be insufficient. Also confirm the deployment includes this feature and uses the database where migration 110 was applied. Do not weaken RLS to make the screen load.

### `doctor` cannot launch Chrome or load WhatsApp Web

Check the Chrome command in Step 2 and open WhatsApp Web manually to check network reachability. If Chrome is installed somewhere else, add a comma after the existing `port` line and add this configuration field, using the actual executable path:

```json
"chromium_path": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Keep the whole file valid JSON. Run `doctor` again. Unsupported macOS/browser combinations may require an OS/browser upgrade; do not bypass the check or add detection-bypass flags.

### `status` cannot find the service / `start` fails

Check that Step 10's `install` completed and this file exists:

```sh
ls "$HOME/Library/LaunchAgents/app.ou-soccer.whatsapp.plist"
```

If absent, run `install`. If already loaded, use `restart`. Run commands from your logged-in graphical Mac session, not as root. If it repeatedly exits, read `error.log` and `events.log`; `status` alone does not prove the process stays healthy.

### Worker is offline/stale or logs show RPC/heartbeat failure

Check internet access, then the Supabase URL/public key and the matching worker ID/token in the private file. If you replaced the credential in the website, the previous token is invalid: enter the new one and restart the worker. Check that the website and worker point to the same project, and that migration 110 is complete. Generic RPC errors can indicate any of these problems; do not assume every failure means the token was revoked. Updated workers synchronize about every thirty seconds and become stale after ninety seconds. Legacy workers continue to report every ten seconds with a thirty-second stale threshold. The dashboard uses the interval reported by the worker.

### `Worker already running` or another worker owns the lease

Do not start another sender. Stop any foreground diagnostic worker with Control + C, or stop the background service using its command. A database lease may take up to thirty seconds to expire after a crash. A normal restart reuses the same local account session; deleting session files is not the first troubleshooting step.

### Pairing page unavailable, expired, or no QR

Confirm the service is running, then use `restart`, wait for startup, and use `pair`. Open its generated URL on the same Mac within ten minutes. If the page says `ready`, pairing has already completed and no QR is needed. For `auth_failure`, check the phone's linked devices and use the dashboard's **Reconnect** control; then reopen a fresh pairing page if required.

### Pairing port already in use

Inspect the listener without terminating it:

```sh
lsof -nP -iTCP:43821 -sTCP:LISTEN
```

If it belongs to an existing worker, manage that worker instead of starting a second one. If another application needs that port, stop the worker, change `port` in the private configuration to an unused value such as `43822`, then start it again. Run `pair` to open the new URL; you do not need to configure a public port anywhere.

### Connection is ready, but schedules do not appear in history or tests stay pending

A recent heartbeat confirms the worker can report its connection state; it does not prove every processing step is succeeding. The worker now isolates command processing, schedule scans, and due-execution handling, and runs group discovery separately so a failed or slow group refresh cannot block the scheduler.

Check `events.log` for `worker_processing_failed`. Entries identify the failing step and, for database requests, a safe operation/error code. They deliberately omit upstream messages that could contain private data. If the worker is running an older build, follow the update/rebuild instructions above and restart it; refreshing the website alone does not update the Mac worker.

After processing recovers, expired tests and missed scheduled runs should appear as **missed**. They will not be resent automatically. Verify the next upcoming execution, and use a single confirmed test only when you intend a real message to be sent.

### Connected, but no groups / test button disabled

Allow about a minute for discovery and click Refresh. Verify that the paired account belongs to the intended group. A test requires a ready, healthy worker, a discovered destination, and a valid message preview. Fill any missing variables before sending. Group settings may restrict posting to WhatsApp group admins.

### History says pending, failed, missed, or unknown

| Status | Meaning / next step |
|---|---|
| `pending` | Waiting, preparing, or dispatching. A future scheduled row is normal; check time, worker state, and switches. |
| `sent` | WhatsApp server acknowledgement was observed. Verify the message in the group; this does not mean every recipient read it. |
| `failed` | A known preparation/send problem was recorded. Read Details; correct the underlying problem before a new deliberate attempt. |
| `missed` | The dispatch window expired, for example because the Mac was asleep/offline or a test expired. It will not catch up automatically. |
| `unknown` | Delivery cannot be established safely. Check the group before a manual resend; the worker does not automatically repeat it. |
| `cancelled` | The schedule changed, was disabled/deleted, or the prepared work became invalid before dispatch. |

A local crash can leave an actual dispatch timestamp unavailable. Acknowledgement reconciliation may later change an unknown result to sent. Check WhatsApp before deciding to send again.

## Efficient coordination and Free plan usage

The updated worker combines its heartbeat, control requests, expiry checks, and change detection into one small request every **30 seconds**. A continuously running idle worker therefore makes approximately **2,880 coordination requests per day**, plus startup, configuration/group changes, execution authorization/results, and recovery requests. This is a design baseline, not a measurement of total project usage or a guarantee of staying under a plan allowance.

Schedules and pending work are cached locally and returned again only when their versions change. Upcoming executions are prepared in batches for the existing 24-hour horizon. Local timers prepare messages before their deadlines and dispatch at the scheduled time; there is no one-second Supabase queue polling. A fresh database authorization is still required immediately before every send, and the five-second lateness rule remains in effect.

- A worker lease lasts **90 seconds** and is renewed every 30 seconds. Successful synchronization is separate from the WhatsApp browser's `ready` state.
- New schedules, test requests, reconnect/disconnect, and group-refresh requests normally reach the worker within **30 seconds**. Tests still expire after 60 seconds; configure schedules at least a minute ahead.
- Group discovery runs at startup/reconnection, every **15 minutes**, or on request. The cloud group list is written only when it changes.
- A stable `unknown` outcome is reported once. Failed result reports use bounded backoff up to five minutes, with evidence retained locally. The worker never retries sending the uncertain message itself.
- Visible dashboard tabs poll lightweight status every 30 seconds. Hidden tabs do not poll; templates/destinations and execution summaries are fetched as needed rather than repeatedly returning full message history bodies.

The private `rpc-metrics.json` file contains per-operation request counts and estimated JSON request/response bytes, with no payload contents, credentials, or message text. It is saved at startup, hourly, and on a clean stop. To inspect those local counters:

```sh
cat "$HOME/Library/Application Support/OU Soccer WhatsApp/rpc-metrics.json"
```

Counters cover the current worker process and exclude HTTP/TLS overhead, dashboard traffic, and the rest of the application. Supabase's Usage dashboard remains authoritative for database size and egress. No additional database writes are made for these metrics.

## Reference: templates, timing, and private files

- `{{next_sunday_date}}` is calculated from the scheduled execution's local date, advancing strictly to the following Sunday. It is not calculated from when you edit the template.
- `{{venue}}` and `{{match_time}}` use schedule fields. Unknown or empty placeholders block sending.
- Editing a reusable template does not automatically update previously saved schedules. Select the template again in the schedule editor and save to apply it.
- One-time, daily, and selected-weekday schedules are supported. Toronto DST keeps Monday 9 PM at local 9 PM. Nonexistent recurring spring-forward times are skipped; repeated fall-back times use the earlier offset. One-time nonexistent local times are rejected.
- Messages are prepared up to sixty seconds ahead. Dedicated timers recheck wall time at intervals of at most 250 ms while waiting; event-loop stalls and OS scheduling can still delay them.
- Final database authorization is required before sending. A Supabase outage prevents authorization; a missed run is not replayed automatically. A send already authorized/in progress cannot be recalled by disabling it afterward.
- Dispatch latency measures invocation time minus scheduled time. Network/provider delays mean exact WhatsApp delivery time cannot be guaranteed.
- The worker durably records dispatch intent and does not automatically retry uncertain delivery. It cannot guarantee exactly-once delivery across PostgreSQL and WhatsApp.

| Private local item | Default location / purpose |
|---|---|
| Worker configuration | `~/Library/Application Support/OU Soccer WhatsApp/config.json` |
| WhatsApp linked-device session | `session/` inside that directory |
| Local pairing access link | `pairing.json` inside that directory; keep private |
| Recovery evidence | `journal/` inside that directory |
| Operational logs | `events.log`, `error.log`, and `worker.log` inside that directory |
| Login service definition | `~/Library/LaunchAgents/app.ou-soccer.whatsapp.plist` |

The WhatsApp session and QR material remain local; Supabase stores schedules, group metadata, worker health, and execution records. Do not commit or share the private directory. The Management mobile app does not yet include these screens; use the web dashboard.

## Reference: automated checks and verification limits

These commands are for developers, not prerequisites for ordinary setup. Automated WhatsApp tests use mocks and do not send real messages.

```sh
npx --yes pnpm@11.9.0 test -- lib/tests/communications.test.ts lib/tests/communications-sql.test.ts lib/tests/communications-provider.test.ts
```

```sh
npx --yes pnpm@11.9.0 --filter @ou/communications typecheck
```

```sh
npx --yes pnpm@11.9.0 --filter @ou/whatsapp-worker typecheck
```

```sh
npx --yes pnpm@11.9.0 build
```

The Supabase pgTAP suite (`test:db`) requires a separately configured disposable/local Supabase database. Do not point test/reset tools at the live database for this walkthrough.

Historical implementation verification on November 17, 2026:

- All 36 scheduler tests passed, including mock-provider, timer, and isolated PGlite database tests. Web/shared/worker type checks and worker/production web builds passed.
- A browser fixture checked schedule saving, disabled defaults, confirmed test/activation flows, template/history views, and a 390px mobile layout using mock actions.
- The full suite had 17 failures across eight existing test files; the clean HEAD baseline had the same failing test names.
- Browser launch/page loading passed on Intel macOS 12.7.6, Node 22.23.4, and Chrome 150.0.7871.125. This was not verification of an authenticated account or real delivery latency.
- The live Supabase pgTAP suite, live migration, service installation, phone pairing, real sends, and login/sleep/network recovery were not performed during that implementation verification. Completing the steps above is still necessary for your actual account.

This guide documents setup; rewriting it does not apply migrations, deploy the website, install the service, pair an account, or activate sending.
