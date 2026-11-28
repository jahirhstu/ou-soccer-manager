import { createSupabaseServerClient, getCurrentProgram } from './supabase/server';
import { cashReportFilters, type CashFilters, type CashReport } from './cash-report';

export async function loadCashReport(input: CashFilters, exportAll = false) {
  const filters = cashReportFilters(input);
  const program = await getCurrentProgram();
  if (!program?.id) throw new Error('Select a program to view its cash report.');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_club_cash_report', {
    p_program_id: program.id, p_from: filters.from, p_to: filters.to, p_season_id: filters.season || null,
    p_page: exportAll ? 1 : filters.page, p_page_size: exportAll ? null : filters.pageSize
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Cash report is unavailable.');
  return { report: data as CashReport, filters, program, supabase };
}
