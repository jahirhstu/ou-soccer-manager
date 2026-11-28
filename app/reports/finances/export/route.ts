import { loadCashReport } from '@/lib/cash-report-server';
import { cashReportCsv } from '@/lib/cash-report';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { report, filters } = await loadCashReport(params, true);
    return new Response(cashReportCsv(report), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="club-cash-${filters.from}-to-${filters.to}.csv"`,
      'Cache-Control': 'private, no-store'
    } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Could not export cash report.', { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
