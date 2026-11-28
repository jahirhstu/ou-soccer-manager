export type CashFilters = { from?: string; to?: string; season?: string; page?: string; pageSize?: string };
export type CashRow = { id: string; number: number; date: string; particulars: string; description: string; season: string; money_in: number; money_out: number; balance: number };
export type CashReport = { opening: number; closing: number; money_in: number; money_out: number; count: number; page: number; rows: CashRow[] };
export function cashReportFilters(filters: CashFilters) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const from = filters.from || `${today.slice(0, 7)}-01`;
  const to = filters.to || today;
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new Error('Enter valid dates with From on or before To.');
  if (filters.season && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(filters.season)) throw new Error('Select a valid season.');
  const requested = Number(filters.page);
  return { from, to, season: filters.season || '', page: Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 2147483647) : 1,
    pageSize: [10, 25, 50].includes(Number(filters.pageSize)) ? Number(filters.pageSize) : 25 };
}
export function cashReportCsv(report: CashReport) {
  const cell = (value: unknown) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [
    ['No.', 'Date', 'Particulars', 'Season', 'In', 'Out', 'Running Cash Balance', 'Description'],
    ['', '', 'Opening Cash Balance', '', '', '', report.opening, ''],
    ...report.rows.map(r => [r.number, r.date, r.particulars, r.season, r.money_in, r.money_out, r.balance, r.description]),
    ['', '', 'Closing Cash Balance', '', report.money_in, report.money_out, report.closing, '']
  ].map(row => row.map(cell).join(',')).join('\r\n');
}
