export default function SetupPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="panel grid max-w-2xl gap-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Supabase setup required</h1>
          <p className="mt-2 text-sm text-slate-600">
            Add your Supabase project URL and publishable key before using the app locally.
          </p>
        </div>

        <div className="rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-100 shadow-soft">
          <div>NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co</div>
          <div>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key</div>
          <div>SUPABASE_SECRET_KEY=your-secret-key-for-seed-only</div>
        </div>

        <p className="text-sm text-slate-600">
          Put these values in <code className="rounded bg-slate-100 px-1">.env.local</code>, then stop and restart <code className="rounded bg-slate-100 px-1">npm run dev</code>.
          You can find the values in Supabase under Project Settings, API.
        </p>
      </section>
    </main>
  );
}
