import { AppShell } from "../(shell)";

export default function SettingsPage() {
  return (
    <AppShell>
      <h1 className="page-title">Settings</h1>
      <div className="panel mt-5 p-5 text-sm text-slate-600">
        Manage roles in Supabase profiles. Service role keys stay server-side only.
      </div>
    </AppShell>
  );
}
