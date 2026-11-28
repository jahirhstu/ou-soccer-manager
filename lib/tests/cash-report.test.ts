import { describe,it,expect } from 'vitest';
import { cashReportFilters,cashReportCsv } from '../cash-report';
describe('cash report inputs and CSV',()=>{
  it('validates calendar dates and ranges',()=>{for(const from of ['2026-02-30','bad','2026-13-01']) expect(()=>cashReportFilters({from})).toThrow('valid dates');expect(()=>cashReportFilters({from:'2026-11-30',to:'2026-11-01'})).toThrow();});
  it('normalizes pagination and validates season identifiers',()=>{expect(cashReportFilters({page:'-1',pageSize:'12'})).toMatchObject({page:1,pageSize:25});expect(()=>cashReportFilters({season:'bad'})).toThrow('valid season');});
  it('includes opening, transactions, closing and escaped descriptions',()=>{const csv=cashReportCsv({opening:500,closing:700,money_in:200,money_out:0,count:1,page:1,rows:[{id:'x',number:1,date:'2026-11-01',particulars:'Jahid',season:'Fall',money_in:200,money_out:0,balance:700,description:'Fee, "paid"'}]});expect(csv).toContain('Opening Cash Balance,,,,500');expect(csv).toContain('"Fee, ""paid"""');expect(csv).toContain('Closing Cash Balance,,200,0,700');});
});
