# Scheduled weekly signup imports

Communications → **Signup imports** reads the latest weekly signup from a configured group. It uses the same parser provider, credentials, JSON contract, and name normalization as manual WhatsApp import. The original message is parsed before season priority and capacity are applied to its roster. The worker does not rewrite or post a WhatsApp message.

## Setup

1. Apply migrations through `117_waitlisted_public_status.sql` to the intended Supabase project and deploy the updated website. The website requires its existing `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` and parser configuration (`WHATSAPP_PARSER_PROVIDER` and the relevant provider credentials).
2. Update/build and configure the worker **on the Mac that runs WhatsApp**, using the existing private configuration file:

   ```text
   ~/Library/Application Support/OU Soccer WhatsApp/config.json
   ```

   Here, `~` means your Mac home folder. For your `jahir` account, the full default path is `/Users/jahir/Library/Application Support/OU Soccer WhatsApp/config.json`. This file lives outside the repository; it is separate from `.env.local`.

   Open it in TextEdit from Terminal:

   ```sh
   open -e "$HOME/Library/Application Support/OU Soccer WhatsApp/config.json"
   ```

   Keep the existing fields and credentials. Add an `app_url` field inside the same outer `{ ... }` object. For example, the end of the file could look like this:

   ```json
     "port": 43821,
     "app_url": "https://your-website.example"
   }
   ```

   This is an ending fragment, not a replacement for the whole file. Add a comma after the preceding field, with no comma after the final field. Replace the example URL with the deployed website for the **same Supabase environment** as this worker. Use only the origin, without `/communications` or another path; local development also accepts `http://localhost:3000`.

   Save with **Command + S**, keeping the filename `config.json` and plain-text format. Never put the Supabase service key or LLM key in this file. If the worker was started with a custom `OU_WHATSAPP_HOME`, its configuration is at `<OU_WHATSAPP_HOME>/config.json` instead. If the file does not exist, follow the [initial worker configuration instructions](whatsapp-scheduler.md) first.

   From the repository root, rebuild and restart the installed worker:

   ```sh
   npx --yes pnpm@11.9.0 whatsapp:build
   npx --yes pnpm@11.9.0 whatsapp restart
   ```

3. In Communications, create a signup import schedule. Choose the season and group, execution weekday/time/timezone, session weekday, signup opening weekday/time, and capacity. Save disabled until these are correct, then enable it. New settings are discovered at the next worker coordination (up to an hour when idle); restart the worker for immediate pickup.
4. Ensure the selected season has a confirmed season signup import with reviewed player IDs. This is the membership source; payments alone do not establish season priority.

The example form starts with Thursday 8 PM execution, Sunday sessions, Monday 9 PM signup opening, Toronto timezone, and capacity 21. These are editable defaults, not an enabled schedule. The target is the selected session weekday on or after the execution's local date.

Signup imports are controlled by their own enabled schedules. The automatic outgoing-message switch does not control reading or importing. The Mac must be awake, connected, and paired. If `app_url` is absent, outgoing messaging continues normally and signup importing is inactive. If hosting protection prevents the worker from reaching the app API, the import cannot run; follow the protected-development setup below.

## Selection and allocation

- Fetch the latest 100 messages and check signup candidates before requesting any older history. Stop immediately when the latest valid signup for the target date is found, even if signup opening has not been reached. Expand to 500 and then 2,000 only when no matching signup is found. If the search ends without a match, save the run for review.
- Use broad signup/list signals rather than exact headings, parse candidates newest first, and require the configured session date. A malformed newer plausible signup blocks fallback to an older one. Conflicting lists at the same timestamp require review.
- Use the source numbered list to define the roster and its order. Every numbered player must be present in the parser output; missing names block automatic import. Extra names inferred from announcement prose are excluded from the scheduled roster. Changed headings and WhatsApp formatting are supported; substantially different list structures may require manual import.
- Resolve only unique exact player names or aliases automatically. Multiple substring candidates, unknown names, and approximate suggestions require review. Repeated entries for one resolved player consume one spot.
- Prioritize actual season members who listed themselves, including members in the message's waitlist section. Fill remaining spots with nonmembers in source order, main list before waitlist. Everyone else becomes session waitlisted. Unlisted season members receive no reserved spot.
- Session price may come from the message. No payment receipts are inferred from signup text. Confirmed players receive session charges through the same service as manual WhatsApp import; waitlisted players receive no charge.

## One import process for automation and review

The scheduler and manual WhatsApp importer share parsing, preparation, confirmation, and session usage/charge services. The worker only schedules runs and finds the latest message. Worker authentication and duplicate-run claiming remain database coordination operations; the separate review/finalization database writer and ownership table are removed by migration 116.

When all names resolve and parser checks pass, automatic runs and **Run now** create/reuse the session, save attendance, and charge confirmed players. Session names use the date in words (for example, **November 29th**). Playground matching reuses the unique existing organization venue and its canonical name; no new playground is created. Existing attendance conflicts require manual review.

If a name is unresolved, capacity is exceeded, or parsing needs review, no new session or attendance is created. The run retains its source and diagnostic status. **View / review in WhatsApp import** opens the existing importer with the original text prefilled and parsed, the configured target selected, and the shared season-priority allocation applied. Opening this page changes no database records. Runs without an extracted message open the importer with an explanation.

Resolve names on that page or explicitly choose to create a new player. Use **Recalculate signup allocation** after changing identities, then confirm through the existing import form. Confirmation recomputes identities and allocation on the server and updates the originating run only after attendance and charging succeed. Already-imported runs open as previews.

An ordinary manual paste keeps explicit waitlist sections waitlisted. A scheduler-linked preview shows the shared allocation, including season-priority promotions to fill capacity. Remaining waitlisted players are uncharged. The public report excludes them from confirmed counts and upcoming confirmed sessions, and displays a separate Waitlisted label.

## Recovery and reruns

Occurrences have a unique database key and exclusive expiring processing claims. The worker can recover a delayed execution for 60 minutes, evaluating message timestamps against the original execution time. Later occurrences are recorded as missed. Claims expire after ten minutes; database run status prevents duplicate attendance after response loss or restart.

The worker reads the current WhatsApp text at execution/recovery time. WhatsApp edits/deletions and unavailable linked-device history can limit reconstructing the exact text that existed earlier; this is not an immutable historical archive. Only the selected signup text, content hash, message identity, parser output, and draft are retained for audit. Older reposts in the fetched batch are not saved. If parsing fails, only the candidate being parsed is kept for retry; retrying an older run clears its previously accumulated candidates.

**Read latest again** creates an explicit rerun for the same session date using messages available now. Reruns use the shared automatic eligibility checks. Automatic attempts encountering existing attendance require review in the manual importer. Review/manage these records explicitly; the scheduler never silently overwrites them. Reruns do not alter completed or cancelled sessions.

The history shows runs needing review, imported runs, missed executions, and errors. For parse failures, retry the saved candidate messages after correcting parser configuration, or request a new read. No group chat response or email is sent by this feature.

## Run an import manually

In **Communications → Signup imports**, click **Run now** on an enabled schedule. No previous import run is needed. It uses the saved season, group, capacity, and session weekday, with the current time as execution time. For example, running on Wednesday with Sunday sessions selects the upcoming Sunday and reads messages from the configured signup opening through now.

The request is queued for the Mac worker's next check (normally within 30 seconds while active; up to an hour while idle). To pick it up sooner while idle, restart the worker from the repository root with `npx --yes pnpm@11.9.0 whatsapp restart`. The worker must be running and connected to WhatsApp. The schedule's regular weekly execution remains in place.

Manual runs import automatically when all checks pass; unresolved or conflicting runs provide the WhatsApp import review link. While a run is queued or reading, **Run now** is disabled. To reread a specific earlier session date, use **Read latest again** on that run in history instead.

The history reader first requests 100 messages and checks candidates immediately. It requests up to 500 and then 2,000 only when the preceding batch contains no matching signup and more history is available. These are increasing history limits, not 2,600 distinct messages. Simple list/signup checks filter candidate messages before any LLM calls. The server then checks candidates newest first, skips clearly dated messages for other sessions, and invokes the configured parser only as needed until it finds the target session's valid signup. Finding a valid signup stops history fetching immediately. A newer plausible signup that fails parsing stops the search for review instead of fetching or importing an older list. Candidates already checked are not sent to the parser again when the history limit expands.

After updating this flow, deploy the updated website API before rebuilding and restarting the Mac worker. No database migration is needed for incremental searching.

## Protected development deployments on Vercel

If a run remains **Queued** and the worker logs `vercel_deployment_protected` (older builds show only `operation_failed`), Vercel is rejecting the request before the signup API runs. Your browser's Vercel login is not available to the Mac worker.

1. In the Vercel project, open **Settings → Deployment Protection → Protection Bypass for Automation** and generate/copy an automation bypass secret. See [Vercel's instructions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation). If Vercel requires a redeploy after creating or changing the secret, redeploy development before retrying.
2. Add it to the Mac's private worker configuration, alongside the development website URL:

   ```json
     "app_url": "https://ou-soccer-manager-git-develop-jahirhstu.vercel.app",
     "vercel_bypass_secret": "YOUR-VERCEL-AUTOMATION-BYPASS-SECRET"
   ```

   Keep the other configuration fields. This secret belongs only in the private Mac configuration; do not commit it or place it in browser/mobile code. The worker sends it in an HTTP header to the configured app origin and refuses redirects. The signup API still requires the separate worker ID, worker token, and active lease.
3. From the repository root, run `npx --yes pnpm@11.9.0 whatsapp:build`, then `npx --yes pnpm@11.9.0 whatsapp restart`. The existing queued run will be picked up; another **Run now** request is not needed.

Other diagnostics distinguish `worker_authorization_failed` (check that the website and worker use the same Supabase environment and matching provisioned credentials), `endpoint_not_deployed`, `endpoint_server_error`, and `endpoint_network_or_redirect_failed`. Diagnostic logs omit credentials and response bodies.

## Development repair after the shared-import upgrade

`scripts/repair-scheduled-signup-dev.ts` previews finalized future signup sessions in the configured development club. With `--apply`, it waits for the shared importer deployment, applies migrations 116–117, and calls the same session-usage service to fill missing charges and ledger links. It validates the development project identity, preserves existing waivers, excludes pending drafts and historical/completed sessions, and verifies waitlisted players have no charges. Production is never a target.
