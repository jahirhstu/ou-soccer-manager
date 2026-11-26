# Scheduled weekly signup imports

Communications → **Signup imports** reads the latest weekly signup from a configured group. It uses the same parser provider, credentials, JSON contract, and name normalization as manual WhatsApp import. The original message is parsed before season priority and capacity are applied to its roster. The worker does not rewrite or post a WhatsApp message.

## Setup

1. Apply migration `114_scheduled_signup_imports.sql` to the intended Supabase project and deploy the updated website. The website requires its existing `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` and parser configuration (`WHATSAPP_PARSER_PROVIDER` and the relevant provider credentials).
2. Update/build the Mac worker and add `"app_url": "https://your-website.example"` to its private `config.json`. Use the website origin without a path; local development also accepts `http://localhost:3000`. Never put the Supabase service key or LLM key in the worker configuration. Restart the worker.
3. In Communications, create a signup import schedule. Choose the season and group, execution weekday/time/timezone, session weekday, signup opening weekday/time, and capacity. Save disabled until these are correct, then enable it. New settings are discovered at the next worker coordination (up to an hour when idle); restart the worker for immediate pickup.
4. Ensure the selected season has a confirmed season signup import with reviewed player IDs. This is the membership source; payments alone do not establish season priority.

The example form starts with Thursday 8 PM execution, Sunday sessions, Monday 9 PM signup opening, Toronto timezone, and capacity 21. These are editable defaults, not an enabled schedule. The target is the selected session weekday on or after the execution's local date.

Signup imports are controlled by their own enabled schedules. The automatic outgoing-message switch does not control reading or importing. The Mac must be awake, connected, and paired. If `app_url` is absent, outgoing messaging continues normally and signup importing is inactive. If hosting protection prevents the worker from reaching the app API, the import cannot run; the worker records an endpoint failure.

## Selection and allocation

- Fetch up to 2,000 messages and require a message at or before signup opening to establish history coverage. A short WhatsApp Web history result alone does not prove completeness. Incomplete history requires review/rereading, rather than importing a possibly stale message.
- Use broad signup/list signals rather than exact headings, parse candidates newest first, and require the configured session date. A malformed newer plausible signup blocks fallback to an older one. Conflicting lists at the same timestamp require review.
- Preserve numbered list order from the source and validate it against the parser output. Missing or added roster names block automatic import. Changed headings and WhatsApp formatting are supported; substantially different list structures may require manual import.
- Resolve only unique exact player names or aliases automatically. Multiple substring candidates, unknown names, and approximate suggestions require review. Repeated entries for one resolved player consume one spot.
- Prioritize actual season members who listed themselves, including members in the message's waitlist section. Fill remaining spots with nonmembers in source order, main list before waitlist. Everyone else becomes session waitlisted. Unlisted season members receive no reserved spot.
- Session price may come from the message. No payment records or player charges are created by this feature.

## Sessions and review

When the message parses and season membership is available, a unique existing scheduled session is reused or a missing session is created. Existing session metadata is preserved. Multiple matching sessions, completed/cancelled sessions, or disabled program modules require intervention.

If identities remain unresolved, season members exceed capacity, or parser warnings/fallbacks require review, the session and roster draft are saved. **Draft players are not attendance.** Review the original message and proposed roster in the Signup imports history. Select existing players, explicitly create a new player, or ignore an entry; save/recalculate to see the resulting priority allocation, then finalize attendance.

If every identity and parser check passes, the first scheduled run finalizes automatically. Finalization is transactional. It writes confirmed and waitlisted attendance only. Waitlist/source ordering is retained in the saved draft and attendance notes.

## Recovery and reruns

Occurrences have a unique database key and exclusive expiring processing claims. The worker can recover a delayed execution for 60 minutes, evaluating message timestamps against the original execution time. Later occurrences are recorded as missed. Claims expire after ten minutes; database run status prevents duplicate attendance after response loss or restart.

The worker reads the current WhatsApp text at execution/recovery time. WhatsApp edits/deletions and unavailable linked-device history can limit reconstructing the exact text that existed earlier; this is not an immutable historical archive. Selected text, content hash, message identity, parser output, and draft are retained for audit.

**Read latest again** creates an explicit rerun for the same session date using messages available now. Every manual rerun requires roster review before applying changes. A rerun may replace earlier attendance owned by the same schedule. Manually maintained attendance, manual edits to imported attendance, and another schedule's roster block replacement. Review/manage these records explicitly; the scheduler never silently overwrites them. Reruns do not alter completed or cancelled sessions.

The history shows runs needing review, imported runs, missed executions, and errors. For parse failures, retry the saved candidate messages after correcting parser configuration, or request a new read. No group chat response or email is sent by this feature.
