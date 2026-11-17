import { expect, it, vi } from 'vitest';
import { BackgroundWorkerStep, runWorkerSteps, WorkerOperationError, processingError } from '../../apps/whatsapp-worker/src/operations';
it('continues schedule and due processing when WhatsApp group sync fails',async()=>{
  const scan=vi.fn(async()=>{}),due=vi.fn(async()=>{}),failure=vi.fn();
  await runWorkerSteps([{name:'group_sync',run:async()=>{throw new Error('private upstream error');}},{name:'schedule_scan',run:scan},{name:'due_executions',run:due}],failure);
  expect(scan).toHaveBeenCalledOnce();expect(due).toHaveBeenCalledOnce();expect(failure).toHaveBeenCalledWith('group_sync',expect.any(Error));
});
it('still processes expired manual requests when schedule scanning fails',async()=>{
  const due=vi.fn(async()=>{});
  await runWorkerSteps([{name:'schedule_scan',run:async()=>{throw new RangeError('invalid schedule');}},{name:'due_executions',run:due}],()=>{});
  expect(due).toHaveBeenCalledOnce();
});
it('records operation and database error code without upstream private details',()=>{
  expect(processingError(new WorkerOperationError('materialize','23502'))).toEqual({operation:'materialize',code:'23502'});
  expect(processingError(new Error('private token or message'))).toEqual({code:'operation_failed'});
});

it('does not block scheduler work or duplicate an in-flight group discovery',async()=>{
  const background=new BackgroundWorkerStep(),failure=vi.fn();let release!:()=>void;
  const groups=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  background.start({name:'group_sync',run:groups},failure);
  background.start({name:'group_sync',run:groups},failure);
  const due=vi.fn(async()=>{});await runWorkerSteps([{name:'due_executions',run:due}],failure);
  expect(groups).toHaveBeenCalledOnce();expect(due).toHaveBeenCalledOnce();release();await new Promise(resolve=>setTimeout(resolve,0));
  background.start({name:'group_sync',run:groups},failure);await Promise.resolve();expect(groups).toHaveBeenCalledTimes(2);release();
});
it('captures rejected background discovery safely and allows its next attempt',async()=>{
  const background=new BackgroundWorkerStep(),failure=vi.fn();
  const groups=vi.fn(async()=>{throw new TypeError('private group metadata');});
  background.start({name:'group_sync',run:groups},failure);await new Promise(resolve=>setTimeout(resolve,0));
  expect(failure).toHaveBeenCalledWith('group_sync',expect.any(TypeError));
  background.start({name:'group_sync',run:groups},failure);await new Promise(resolve=>setTimeout(resolve,0));expect(groups).toHaveBeenCalledTimes(2);
});
