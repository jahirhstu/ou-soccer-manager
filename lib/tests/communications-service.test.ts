import {expect,it,vi} from 'vitest';
import {bootstrapAfterStop} from '../../apps/whatsapp-worker/src/service';
it('retries transient launchd unload failures until bootstrap succeeds',async()=>{
  const bootstrap=vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(5).mockReturnValue(0),wait=vi.fn(async()=>{});
  expect(await bootstrapAfterStop(bootstrap,()=>false,wait)).toBe(0);expect(wait.mock.calls).toEqual([[250],[500]]);
});
it('bounds retries and preserves persistent errors',async()=>{
  const bootstrap=vi.fn(()=>5);expect(await bootstrapAfterStop(bootstrap,()=>false,async()=>{})).toBe(5);expect(bootstrap).toHaveBeenCalledTimes(5);
});
it('waits for a booted-out service to disappear before bootstrapping again',async()=>{
  const bootstrap=vi.fn().mockReturnValueOnce(5).mockReturnValue(0),loaded=vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const wait=vi.fn(async()=>{});expect(await bootstrapAfterStop(bootstrap,loaded,wait)).toBe(0);expect(bootstrap).toHaveBeenCalledTimes(2);expect(wait).toHaveBeenCalledTimes(2);
});
it('preserves unrelated errors without retrying',async()=>{
  const wait=vi.fn(async()=>{});expect(await bootstrapAfterStop(()=>78,()=>false,wait)).toBe(78);expect(wait).not.toHaveBeenCalled();
});
