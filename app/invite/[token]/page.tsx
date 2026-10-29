import Link from "next/link";
import { acceptInvitationAction } from "@/lib/actions/invitations";

export default async function InvitationPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form action={acceptInvitationAction} className="panel grid w-full max-w-md gap-4 p-6">
        <input name="token" type="hidden" value={token} />
        <h1 className="text-2xl font-semibold tracking-tight">Organization invitation</h1>
        <p className="text-sm text-slate-600">Sign in with the invited email address, then accept this invitation.</p>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <button className="btn-primary justify-center">Accept invitation</button>
        <Link className="text-sm font-semibold text-pitch" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in first</Link>
      </form>
    </main>
  );
}
