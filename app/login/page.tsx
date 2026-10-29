import Link from "next/link";
import { loginAction } from "@/lib/actions/auth";
import { tenantPath } from "@/lib/tenant";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string; next?: string }> }) {
  const { error, message, next } = await searchParams;
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form action={loginAction} className="panel grid w-full max-w-sm gap-4 p-6">
        <input name="tenant_slug" type="hidden" value={tenantSlug} />
        <input name="program_slug" type="hidden" value={programSlug} />
        <input name="next" type="hidden" value={next ?? ""} />
        <div>
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-pitch text-sm font-black text-white shadow-soft">OU</div>
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="mt-1 text-sm text-slate-500">Access your organizations and programs.</p>
        </div>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}
        <input autoCapitalize="none" autoComplete="email" className="input" name="email" placeholder="Email" type="email" required />
        <input className="input" name="password" placeholder="Password" type="password" required />
        <button className="btn-primary justify-center">Log in</button>
        <Link className="text-sm font-semibold text-pitch hover:text-ink" href={tenantPath("/signup", tenantSlug, programSlug)}>Create an account</Link>
      </form>
    </main>
  );
}
