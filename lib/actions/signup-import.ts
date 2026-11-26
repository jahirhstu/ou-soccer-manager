'use server';
import { tenantPath } from '../tenant';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient, getCurrentProfile } from '../supabase/server';
import { createSupabaseAdminClient } from '../supabase/admin';
import { requireOrganizationAdminAuthority } from '../organization-access';
import { requireEnabledProgramModule } from '../program-access';
import { signupScheduleSchema, signupWindow } from '../../packages/communications/src/signup-import';
import { type SignupRun } from '../signup-import-service';
async function context() {
  const profile = await getCurrentProfile();
  if (!profile?.organization_id) throw new Error('Organization context required');
  const user = await createSupabaseServerClient();
  await requireOrganizationAdminAuthority(user, profile.organization_id);
  return { db: createSupabaseAdminClient(), user, organizationId: profile.organization_id, profileId: profile.id };
}
export async function signupImportData() {
  const { db, organizationId } = await context();
  const results = await Promise.all([
    db.from('signup_import_schedules').select('*').eq('organization_id', organizationId).order('created_at'),
    db.from('signup_import_runs').select('*').eq('organization_id', organizationId).order('scheduled_at', { ascending: false }).limit(30),
    db.from('seasons').select('id,name,program_id').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    db.from('message_destinations').select('id,name').eq('organization_id', organizationId).eq('available', true).order('name'),
    db.from('players').select('id,display_name').eq('organization_id', organizationId).order('display_name').limit(1000),
    db.from('organizations').select('slug').eq('id',organizationId),
    db.from('programs').select('id,slug').eq('organization_id',organizationId)
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const reviewLinks=Object.fromEntries((results[1].data??[]).map((run:any)=>[run.id,`${tenantPath('/import-whatsapp',(results[5].data?.[0] as any)?.slug,(results[6].data as any[])?.find(p=>p.id===run.configuration.program_id)?.slug)}?signupRun=${encodeURIComponent(run.id)}`]));
  return { reviewLinks, schedules: results[0].data ?? [], runs: (results[1].data ?? []) as SignupRun[], seasons: results[2].data ?? [], destinations: results[3].data ?? [], players: results[4].data ?? [] };
}
export async function signupImportMutation(operation: string, input: unknown) {
  try {
    const { db, user, organizationId, profileId } = await context();
    const data = z.record(z.unknown()).parse(input);
    if (operation === 'save') {
      const schedule = signupScheduleSchema.parse(data);
      const season = await db.from('seasons').select('program_id').eq('id', schedule.season_id).eq('organization_id', organizationId).single();
      if (season.error || !season.data?.program_id) throw new Error('Select a season in this organization');
      await requireEnabledProgramModule(user, organizationId, season.data.program_id, 'whatsapp_import');
      const payload = { ...schedule, program_id: season.data.program_id, organization_id: organizationId };
      const query = data.id ? db.from('signup_import_schedules').update(payload).eq('id', z.string().uuid().parse(data.id)).eq('organization_id', organizationId)
        : db.from('signup_import_schedules').insert({ ...payload, created_by: profileId });
      const result = await query;
      if (result.error) throw new Error(result.error.message);
    } else if (operation === 'run_now') {
      const id = z.string().uuid().parse(data.id);
      const schedule = await db.from('signup_import_schedules').select('*').eq('id', id).eq('organization_id', organizationId).eq('enabled', true).single();
      if (schedule.error || !schedule.data) throw new Error('Enable the schedule before running it manually');
      await requireEnabledProgramModule(user, organizationId, schedule.data.program_id, 'whatsapp_import');
      const active = await db.from('signup_import_runs').select('id').eq('organization_id', organizationId).eq('schedule_id', id).in('status', ['queued', 'reading']).limit(1).maybeSingle();
      if (active.error) throw new Error(active.error.message);
      if (active.data) throw new Error('This schedule already has a queued or running import');
      const now = new Date().toISOString();
      const window = signupWindow(schedule.data, now);
      const result = await db.from('signup_import_runs').insert({ organization_id: organizationId, schedule_id: id, scheduled_at: now,
        target_date: window.target_date, window_from: window.from, window_until: window.until, configuration: schedule.data, manual: true });
      if (result.error) throw new Error(result.error.message);
    } else {
      const id = z.string().uuid().parse(data.id);
      const query = await db.from('signup_import_runs').select('*').eq('id', id).eq('organization_id', organizationId).single();
      if (query.error || !query.data) throw new Error('Run unavailable');
      const run = query.data as SignupRun;
      await requireEnabledProgramModule(user, organizationId, run.configuration.program_id, 'whatsapp_import');
      if (operation === 'rerun') {
        const schedule = await db.from('signup_import_schedules').select('*').eq('id', run.schedule_id).eq('organization_id', organizationId).eq('enabled', true).single();
        if (schedule.error) throw new Error('Enable the schedule before requesting a rerun');
        const now = new Date().toISOString();
        const result = await db.from('signup_import_runs').insert({ organization_id: organizationId, schedule_id: run.schedule_id, scheduled_at: now, target_date: run.target_date,
          window_from: run.window_from, window_until: now, configuration: schedule.data, manual: true });
        if (result.error) throw new Error(result.error.message);
      } else throw new Error('Unknown signup import operation');
    }
    revalidatePath('/communications');
    return { success: true };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Signup import request failed' }; }
}
