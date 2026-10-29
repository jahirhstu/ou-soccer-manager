"use server";

import { z } from 'zod';
import { createSupabaseServerClient, getCurrentProfile } from '../supabase/server';
import { refreshEnabled, type RefreshJob } from '../production-refresh';

async function context() {
  if (!refreshEnabled()) throw new Error('Production refresh is unavailable in this environment.');
  const profile = await getCurrentProfile();
  const db = await createSupabaseServerClient();
  const { data } = await db.from('organization_members').select('role')
    .eq('organization_id', profile?.organization_id).eq('profile_id', profile?.id).eq('status', 'active').maybeSingle();
  if (!data || !['owner', 'admin'].includes(data.role)) throw new Error('Organization admin access required.');
  return { db, organizationId: profile.organization_id };
}

export async function refreshStatus(): Promise<{ jobs?: RefreshJob[]; error?: string }> {
  try {
    const { db, organizationId } = await context();
    const { data, error } = await db.from('development_refresh_jobs')
      .select('id,status,created_at,error,preview,expires_at').eq('organization_id', organizationId)
      .order('created_at', { ascending: false }).limit(5);
    if (error) throw new Error('Refresh history is unavailable. Check deployment configuration.');
    return { jobs: data as RefreshJob[] };
  } catch (error) { return { error: (error as Error).message }; }
}

export async function requestRefresh(command: string, jobId?: string) {
  try {
    const input = z.object({ command: z.enum(['analyze', 'confirm', 'cancel']), jobId: z.string().uuid().optional() })
      .parse({ command, jobId });
    const { db, organizationId } = await context();
    const { error } = await db.rpc('request_development_refresh', {
      p_organization_id: organizationId, p_job_id: input.jobId ?? null, p_command: input.command
    });
    if (error) return { error: error.code === '23505' ? 'A refresh is already in progress.' : error.message };
    return {};
  } catch (error) { return { error: (error as Error).message }; }
}
