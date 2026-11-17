'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { scheduleSchema, signupTemplate, upcoming, renderMessage } from '@ou/communications';
import { createSupabaseServerClient, getCurrentProfile } from '../supabase/server';
import { requireOrganizationAdminAuthority } from '../organization-access';

async function context() {
  const profile = await getCurrentProfile();
  if (!profile?.organization_id) throw new Error('Organization context required');
  const db = await createSupabaseServerClient();
  await requireOrganizationAdminAuthority(db, profile.organization_id);
  return { db, organizationId: profile.organization_id as string };
}
const executionSummary = 'id,schedule_id,scheduled_at,status,phase,is_test,dispatch_at,acknowledgement_at,latency_ms,error,provider_message_id';

export async function communicationsData() {
  const { db, organizationId } = await context();
  const results = await Promise.all([
    db.from('message_templates').select('*').eq('organization_id', organizationId).order('name'),
    db.from('message_schedules').select('*').eq('organization_id', organizationId).is('deleted_at', null).order('created_at'),
    db.from('message_destinations').select('*').eq('organization_id', organizationId).eq('available', true).order('name'),
    db.from('message_executions').select(executionSummary).eq('organization_id', organizationId).order('scheduled_at', { ascending: false }).limit(100),
    db.rpc('message_admin', { p_organization_id: organizationId, p_operation: 'status' })
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  return { templates: results[0].data ?? [], schedules: results[1].data ?? [], destinations: results[2].data ?? [], executions: results[3].data ?? [], connection: results[4].data, organizationId };
}
export async function communicationsStatus(configurationRevision?: string, workRevision?: string, includeHistory = false) {
  const { db, organizationId } = await context();
  const { data: connection, error } = await db.rpc('message_admin', { p_organization_id: organizationId, p_operation: 'status' });
  if (error) throw new Error(error.message);
  const configurationChanged = String(connection?.configuration_revision ?? '') !== String(configurationRevision ?? '');
  const workChanged = String(connection?.work_revision ?? '') !== String(workRevision ?? '');
  let executions;
  if (includeHistory && workChanged) {
    const result = await db.from('message_executions').select(executionSummary).eq('organization_id', organizationId).order('scheduled_at', { ascending: false }).limit(100);
    if (result.error) throw new Error(result.error.message);
    executions = result.data ?? [];
  }
  return { connection, configurationChanged, executions };
}
export async function communicationsMutation(operation: string, input: unknown) {
  try {
    const { db, organizationId } = await context();
    const data = z.record(z.unknown()).parse(input);
    if (operation === 'schedule') {
      const schedule = scheduleSchema.parse(data);
      const dates = upcoming(schedule);
      if (schedule.enabled && !dates.length) throw new Error('Schedule must have a future execution');
      renderMessage(schedule.body, dates[0] ?? new Date().toISOString(), schedule.timezone, schedule);
      const query = data.id
        ? db.from('message_schedules').update(schedule).eq('id', z.string().uuid().parse(data.id)).eq('organization_id', organizationId)
        : db.from('message_schedules').insert({ ...schedule, organization_id: organizationId });
      const { error } = await query;
      if (error) throw error;
    } else if (operation === 'delete_schedule') {
      const { error } = await db.from('message_schedules').update({ deleted_at: new Date().toISOString(), enabled: false })
        .eq('id', z.string().uuid().parse(data.id)).eq('organization_id', organizationId);
      if (error) throw error;
    } else if (operation === 'template') {
      const template = z.object({ name: z.string().trim().min(1).max(120), body: z.string().min(1).max(10000) }).parse(data);
      const query = data.id ? db.from('message_templates').update(template).eq('id', z.string().uuid().parse(data.id)).eq('organization_id', organizationId)
        : db.from('message_templates').insert({ ...template, organization_id: organizationId });
      const { error } = await query;
      if (error) throw error;
    } else if (operation === 'setup') {
      const { error: templateError } = await db.from('message_templates').upsert({ organization_id: organizationId, name: 'OU Soccer Weekly Signup', body: signupTemplate }, { onConflict: 'organization_id,name', ignoreDuplicates: true });
      if (templateError) throw templateError;
      const { data: existing, error: findError } = await db.from('message_schedules').select('id').eq('organization_id', organizationId).eq('name', 'OU Soccer Weekly Signup').is('deleted_at', null).limit(1);
      if (findError) throw findError;
      if (!existing?.length) {
        const { error } = await db.from('message_schedules').insert({ organization_id: organizationId, name: 'OU Soccer Weekly Signup', body: signupTemplate, frequency: 'weekly', weekdays: [1], local_time: '21:00:00', timezone: 'America/Toronto', venue: 'Bell Sensplex', match_time: '7 AM – 9 AM', enabled: false });
        if (error) throw error;
      }
    } else if (operation === 'refresh_groups') {
      const { error } = await db.rpc('message_request_group_refresh', { p_organization_id: organizationId });
      if (error) throw error;
    } else if (['provision', 'automation', 'reconnect', 'disconnect', 'test'].includes(operation)) {
      let payload: Record<string, unknown> = {};
      if (operation === 'automation') payload = z.object({ enabled: z.boolean() }).parse(data);
      if (operation === 'test') {
        const test = z.object({ destination_id: z.string().uuid(), body: z.string().min(1).max(10000), timezone: z.string(), venue: z.string(), match_time: z.string(), confirmed: z.literal(true) }).parse(data);
        payload = { destination_id: test.destination_id, body: renderMessage(test.body, new Date().toISOString(), test.timezone, test) };
      }
      const { data: result, error } = await db.rpc('message_admin', { p_organization_id: organizationId, p_operation: operation, p_data: payload });
      if (error) throw error;
      revalidatePath('/communications');
      return { success: true, result };
    } else throw new Error('Unknown operation');
    revalidatePath('/communications');
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Communication request failed' };
  }
}
