import { redirect } from "next/navigation";
import { DateInput, MoneyInput, ProgramSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { saveExpense } from "@/lib/actions/crud";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function NewExpensePage() {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const supabase = await createSupabaseServerClient();
  const currentProgram = await getCurrentProgram();
  let seasonsQuery = supabase.from("seasons").select("*").order("name");
  let sessionsQuery = supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false });
  if (currentProgram?.id) {
    seasonsQuery = seasonsQuery.eq("program_id", currentProgram.id);
    sessionsQuery = sessionsQuery.eq("program_id", currentProgram.id);
  }
  const [{ data: seasons }, { data: sessions }, { data: programs }] = await Promise.all([
    seasonsQuery,
    sessionsQuery,
    supabase.from("programs").select("*").eq("status", "active").order("name")
  ]);

  return (
    <AppShell>
      <form action={saveExpense} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">Record expense</h1>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Program
          <ProgramSelect programs={programs ?? []} defaultValue={currentProgram?.id} emptyLabel="Use selected season/session program" />
        </label>
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
