import { redirect } from "next/navigation";
import { DateInput, MoneyInput, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { saveExpense } from "@/lib/actions/crud";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function NewExpensePage() {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const supabase = await createSupabaseServerClient();
  const [{ data: seasons }, { data: sessions }] = await Promise.all([
    supabase.from("seasons").select("*").order("name"),
    supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false })
  ]);

  return (
    <AppShell>
      <form action={saveExpense} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">Record expense</h1>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Season
          <SeasonSelect seasons={seasons ?? []} required={false} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Session
          <SessionSelect sessions={sessions ?? []} required={false} />
        </label>
        <DateInput name="expense_date" required />
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Category
          <select className="input" name="category" required>
            <option value="dome_rent">Dome rent</option>
            <option value="food">Food</option>
            <option value="jersey">Jersey</option>
            <option value="equipment">Equipment</option>
            <option value="other">Other</option>
          </select>
        </label>
        <MoneyInput name="amount" required />
        <input className="input" name="vendor" placeholder="Vendor, payee, or store" />
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit">Save</button>
      </form>
    </AppShell>
  );
}
