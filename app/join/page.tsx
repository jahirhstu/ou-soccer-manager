import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ requested?: string; error?: string }> }) {
  const { requested, error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: pending } = auth.user
    ? await supabase.from("organization_members").select("id,status,organizations(name,slug)").eq("profile_id", auth.user.id).eq("status", "pending")
    : { data: [] };
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="panel grid w-full max-w-xl gap-4 p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organization access</h1>
        {requested ? <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Your access request is pending approval.</p> : null}
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Access to that organization or program is required.</p> : null}
        {(pending ?? []).map((membership: any) => {
          const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
          return <div className="rounded-md border border-line p-3 text-sm" key={membership.id}>{organization?.name ?? "Organization"} - pending approval</div>;
        })}
        {!pending?.length ? <p className="text-sm text-slate-600">Use an organization signup URL or invitation link to request access.</p> : null}
        <Link className="text-sm font-semibold text-pitch" href="/login">Return to login</Link>
      </section>
    </main>
  );
}
