import Link from "next/link";
import { loginAction } from "@/lib/actions/auth";
import { tenantPath } from "@/lib/tenant";
import { getRequestTenantSlug } from "@/lib/tenant-server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const tenantSlug = await getRequestTenantSlug();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form action={loginAction} className="panel grid w-full max-w-sm gap-4 p-6">
        <input name="tenant_slug" type="hidden" value={tenantSlug} />
        <div>
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-pitch text-sm font-black text-white shadow-soft">OU</div>
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="mt-1 text-sm text-slate-500">Access club payments, sessions, and player reports.</p>
        </div>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          One word name
          <span className="flex min-h-10 items-center overflow-hidden rounded-md border border-line bg-white shadow-sm focus-within:border-pitch focus-within:ring-2 focus-within:ring-emerald-100">
            <input
              autoCapitalize="none"
              autoComplete="username"
              className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
              name="emailName"
              pattern="[A-Za-z0-9._-]+"
              placeholder="put your one word name here, e.g. wali or jahir"
              required
            />
            <span className="shrink-0 border-l border-line bg-slate-50 px-3 text-sm font-medium text-slate-500">@ou.soccer</span>
          </span>
        </label>
        <input className="input" name="password" placeholder="Password" type="password" required />
        <button className="btn-primary justify-center">Log in</button>
        <Link className="text-sm font-semibold text-pitch hover:text-ink" href={tenantPath("/signup", tenantSlug)}>Create an account</Link>
      </form>
    </main>
  );
}
