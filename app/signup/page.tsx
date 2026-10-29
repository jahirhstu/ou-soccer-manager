import Link from "next/link";
import { requestMembershipAction, signupAction } from "@/lib/actions/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form action={auth.user ? requestMembershipAction : signupAction} className="panel grid w-full max-w-sm gap-4 p-6">
        <input name="tenant_slug" type="hidden" value={tenantSlug} />
        <input name="program_slug" type="hidden" value={programSlug} />
        <div>
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-pitch text-sm font-black text-white shadow-soft">OS</div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
          <p className="mt-1 text-sm text-slate-500">Create an account and request access. Privileged roles require an invitation.</p>
        </div>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {!auth.user ? <input className="input" name="displayName" placeholder="Display name" required /> : null}
        {!auth.user ? <input autoCapitalize="none" autoComplete="email" className="input" name="email" placeholder="Email" type="email" required /> : null}
        {!auth.user ? <input className="input" name="password" placeholder="Password" type="password" required /> : null}
        <button className="btn-primary justify-center">{auth.user ? "Request access" : "Sign up"}</button>
        <Link className="text-sm font-semibold text-pitch hover:text-ink" href="/login">Log in instead</Link>
      </form>
    </main>
  );
}
