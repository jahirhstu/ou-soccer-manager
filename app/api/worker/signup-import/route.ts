import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { workerInput, workerOrganization, pollSignupRuns, processSignupRun, type SignupRun } from '@/lib/signup-import-service';
export const runtime = 'nodejs';
export const maxDuration = 300;
const inputSchema = workerInput.extend({ ready: z.boolean().optional(), action: z.enum(['poll', 'submit']), run_id: z.string().uuid().optional(), claim_token: z.string().uuid().optional(),
  history_complete: z.boolean().optional(), messages: z.array(z.object({ id: z.string().min(1).max(500), timestamp: z.number().int().nonnegative(), body: z.string().max(30000) })).max(2000).optional() });
export async function POST(request: Request) {
  let run: SignupRun | undefined;
  const db = createSupabaseAdminClient();
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 2000000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    const body = await request.text();
    if (body.length > 2000000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    const input = inputSchema.parse(JSON.parse(body));
    let organizationId: string;
    try { organizationId = await workerOrganization(db, input); }
    catch { return NextResponse.json({ error: 'Worker authorization failed' }, { status: 401 }); }
    if (input.action === 'poll') return NextResponse.json(await pollSignupRuns(db, organizationId, input.instance_id, input.ready === true));
    const result = await db.from('signup_import_runs').select('*').eq('id', input.run_id ?? '').eq('organization_id', organizationId).maybeSingle();
    if (result.error) throw result.error;
    const row = result.data as SignupRun | null;
    if (!row || row.claimed_by !== input.instance_id || row.claim_token !== input.claim_token) return NextResponse.json({ error: 'Run claim unavailable' }, { status: 409 });
    if (row.status !== 'reading') return NextResponse.json({ status: row.status }); // Response loss is safe to retry.
    if (!row.claim_until || Date.parse(row.claim_until) <= Date.now()) return NextResponse.json({ error: 'Run claim expired' }, { status: 409 });
    run = row;
    const evidence = await db.from('signup_import_runs').update({ incoming_messages: input.messages ?? [], history_complete: input.history_complete === true }).eq('id', run.id).eq('claim_token', run.claim_token).eq('status', 'reading');
    if (evidence.error) throw evidence.error;
    const saved = await processSignupRun(db, run, input.messages ?? [], input.history_complete === true);
    return NextResponse.json({ status: saved.status, run_id: saved.id });
  } catch (error) {
    if (run) {
      // Preserve source evidence even if parsing fails; no attendance has been changed.
      const message = error instanceof Error ? error.message : 'Signup processing failed';
      await db.from('signup_import_runs').update({ status: 'needs_review', error: message.slice(0, 1000), claim_until: null, updated_at: new Date().toISOString() }).eq('id', run.id).eq('claim_token', run.claim_token).eq('status', 'reading');
      return NextResponse.json({ status: 'needs_review', run_id: run.id });
    }
    return NextResponse.json({ error: 'Signup import request failed' }, { status: 400 });
  }
}
