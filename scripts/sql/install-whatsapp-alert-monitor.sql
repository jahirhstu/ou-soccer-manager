-- Run only after deploying whatsapp-alerts and adding both named secrets in Vault.
-- This is intentionally separate from the schema migration: monitoring is opt-in per environment.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='whatsapp_alert_function_url')
    or not exists(select 1 from vault.decrypted_secrets where name='whatsapp_alert_monitor_secret') then
    raise exception 'Configure the WhatsApp alert URL and monitor secret in Vault first';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname='whatsapp-worker-alerts';
end $$;
select cron.schedule('whatsapp-worker-alerts','* * * * *',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='whatsapp_alert_function_url' limit 1),
    headers:=jsonb_build_object('Content-Type','application/json','x-monitor-secret',(select decrypted_secret from vault.decrypted_secrets where name='whatsapp_alert_monitor_secret' limit 1)),
    body:='{"action":"monitor"}'::jsonb,
    timeout_milliseconds:=60000
  );
$job$);
