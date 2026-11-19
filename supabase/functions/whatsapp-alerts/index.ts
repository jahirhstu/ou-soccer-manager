// @ts-ignore Deno resolves the explicit .ts extension during Edge Function deployment.
import { createAlertHandler } from './handler.ts';
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
Deno.serve(createAlertHandler({
  supabaseUrl:Deno.env.get('SUPABASE_URL')??'',serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
  resendKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('WHATSAPP_ALERT_FROM'),
  monitorSecret:Deno.env.get('WHATSAPP_ALERT_MONITOR_SECRET'),appUrl:Deno.env.get('WHATSAPP_ALERT_APP_URL')
}));
