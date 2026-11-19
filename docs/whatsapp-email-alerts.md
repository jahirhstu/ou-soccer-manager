# WhatsApp worker email alerts

Alerts are opt-in per organization. They send one failure email and one recovery email per incident. The website never receives the Resend API key. All addresses, incidents, and delivery history are restricted to organization administrators; provider operations run through restricted database functions.

## Behavior

- A running worker reports detected WhatsApp connection/authentication failures, browser compatibility failure, startup failure, control/group processing failures, and result recovery failures immediately. Normal WhatsApp initialization gets two minutes before a timeout alert. Actual authentication or initialization errors report immediately.
- Authoritative failed, missed, and uncertain message outcomes enqueue an incident in the database transaction that records them. The worker requests immediate email delivery after reporting a result; the minute monitor is the fallback for other outcomes or an interrupted worker. An uncertain send is never automatically repeated. Only a confirmed `sent` result resolves an uncertain delivery incident.
- Supabase Cron runs every minute independently of the Mac. Active workers become overdue after their negotiated heartbeat allowance (90 seconds for the adaptive worker). Idle workers become overdue five minutes after their reported next check. The monitor can add up to one minute before attempting an email.
- Intentional idle suspension and explicit WhatsApp logout do not create connection-failure alerts. Stopping the worker still eventually generates a missed-check-in alert while alerts are enabled. Disable alerts before planned worker downtime if that is unwanted.
- Recovery means the affected operation succeeded again. For delivery, it requires acknowledgement evidence. A recovery email waits until its original failure email was accepted by the provider.
- The Mac stores only fixed error categories in private `alerts.json`; failed reports retry at normal coordination, with no extra idle polling. Incident identity survives restarts through the database, and settings revisions travel in normal coordination responses.
- The durable outbox retries at most five attempts. Backoff is 5 seconds, 30 seconds, 2 minutes, then 10 minutes; the minute job makes short delays approximate. Abandoned claims become eligible after two minutes. Delivery payloads are frozen on first attempt, and Resend idempotency keys are reused. Automatic retries stop after 23 hours, within the provider's 24-hour key retention window.
- “Accepted by provider” does not guarantee arrival in the inbox. Check spam and provider logs when needed. Alerts cannot arrive while Supabase or the email provider is unavailable; queued reports retry after connectivity recovers. Invalid/missing local worker credentials may prevent direct reporting, so missed-check-in monitoring is the fallback.

This adds one lightweight server-side monitor per minute (about 1,440 runs/day), plus email function invocations and incident/outbox operations. It does not add periodic requests from an otherwise healthy idle Mac. A Supabase-hosted monitor cannot detect a complete outage of Supabase itself.

## 1. Set up Resend

1. Create a Resend account. Add a domain you control, install its requested DNS verification records, and wait for verification.
2. Choose a sender on that verified domain, such as `OU Soccer Alerts <alerts@your-domain.example>`.
3. Create a sending API key scoped to that domain when available. Store it privately; do not commit it, paste it into the website, or add it to the Mac worker config.
4. Use a separate development recipient and leave development alerts disabled unless testing. Avoid accidentally enabling monitoring against production credentials from a development deployment.

References: [Supabase email functions](https://supabase.com/docs/guides/functions/examples/send-emails), [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## 2. Apply the database migration

Apply migrations 110–112 first, followed by [migration 113](../supabase/migrations/113_whatsapp_email_alerts.sql) through the existing release process. Do not reset the database. Migration 113 creates alert settings, incidents, an email outbox, restricted RPCs, outcome triggers, and a settings revision on coordination responses. It does **not** enable alerts or install a scheduled job.

Older workers retain their existing coordination behavior. They can still be monitored for missed check-ins and delivery outcomes, but immediate client-side failure reports require the rebuilt worker.

## 3. Configure and deploy the Edge Function

Set these **Edge Function secrets** for the intended Supabase project:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | The private Resend sending key |
| `WHATSAPP_ALERT_FROM` | Verified sender address, optionally with a display name |
| `WHATSAPP_ALERT_MONITOR_SECRET` | A newly generated random secret, at least 32 random bytes |
| `WHATSAPP_ALERT_APP_URL` | Optional website origin, e.g. `https://your-app.example` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Edge Function environment. Keep all secrets out of source control and shell history; use the Supabase dashboard or a private environment file with restrictive permissions.

Deploy from this repository with Supabase CLI 3.x, replacing the project reference (`--remote` replaces the older `--project-ref` flag):

```sh
supabase functions deploy whatsapp-alerts --remote=YOUR_PROJECT_REF --no-verify-jwt --use-api --yes
```

The function intentionally uses custom authentication: worker reports validate the worker token in the database; admin actions validate the user's JWT and organization role; monitor requests validate a dedicated secret. Platform JWT verification must be disabled for the Cron and worker paths. This does not make database reporting or email sending public.

No email-provider key or service-role key belongs in browser code or Mac worker configuration.

## 4. Install independent monitoring

In the project's Vault dashboard, create these named secrets:

- `whatsapp_alert_function_url`: the full `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-alerts` URL.
- `whatsapp_alert_monitor_secret`: exactly the same random value as `WHATSAPP_ALERT_MONITOR_SECRET` above.

Run [the monitor installation SQL](../scripts/sql/install-whatsapp-alert-monitor.sql) in that project's SQL editor. It enables `pg_cron` and `pg_net` and installs a single job named `whatsapp-worker-alerts`. Re-running the installer replaces that named job, rather than creating duplicates. Supabase Vault must be available before running it.

Confirm the job is active:

```sql
select jobname, schedule, active from cron.job
where jobname='whatsapp-worker-alerts';
```

Check execution status and the HTTP response status separately: Cron success means the HTTP request was queued, not that the function succeeded.

```sql
select status, start_time, end_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='whatsapp-worker-alerts')
order by start_time desc limit 5;

select id, status_code, timed_out, created from net._http_response
order by created desc limit 5;
```

HTTP 401 usually means the monitor secrets differ. HTTP 503 means configuration, database access, or another dependency needs attention. Avoid exposing Vault values or full request headers when debugging.

Reference: [Scheduling Supabase Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

## 5. Enable and verify

1. Deploy the updated website, rebuild the Mac worker, and restart it normally.
2. Open **Communications → Connections & History → Worker email alerts**. Save the recipient address.
3. Confirm sender and monitor-secret configuration are shown. The UI cannot prove the Cron job was installed; verify step 4 separately.
4. Click **Send test email**. Check both its provider acceptance status and the recipient inbox. Wait at least one minute between tests.
5. Enable alerts. This immediately checks current worker availability, connection state, and recent delivery issues. Changing the recipient disables alerts and requires a fresh successful test.
6. With no message due soon, conduct a controlled worker stop, wait for the missed-check-in allowance plus one monitor interval, and verify one failure email. Restart normally and verify one recovery email. Do not log out or force a real message failure merely to test alerts.

To stop monitoring, disable alerts on the website. To remove the scheduled job as well:

```sql
select cron.unschedule(jobid) from cron.job where jobname='whatsapp-worker-alerts';
```

No live test email or production monitoring is enabled by repository tests.
