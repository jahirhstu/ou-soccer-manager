export class WorkerOperationError extends Error {
  constructor(readonly operation: string, readonly code: string) {
    super(`Worker operation failed: ${operation}`);
  }
}

/** Upstream failures may include message bodies, group data or credentials. */
export function processingError(error: unknown): Record<string, string> {
  if (error instanceof WorkerOperationError) return { operation: error.operation, code: error.code };
  if (error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError', 'RangeError'].includes(error.name)) return { code: error.name };
  return { code: 'operation_failed' };
}

export interface WorkerStep { name: string; run(): Promise<void> }
/** A failed browser/group refresh must not starve schedule scans or expiry processing. */
export async function runWorkerSteps(steps: WorkerStep[], onFailure: (step: string, error: unknown) => void) {
  for (const step of steps) {
    try { await step.run(); }
    catch (error) { onFailure(step.name, error); }
  }
}

/** Slow browser maintenance runs outside the scheduler loop, with one instance at a time. */
export class BackgroundWorkerStep {
  private running = false;
  start(step: WorkerStep, onFailure: (step: string, error: unknown) => void): void {
    if (this.running) return;
    this.running = true;
    void Promise.resolve().then(() => step.run()).catch(error => onFailure(step.name, error)).finally(() => { this.running = false; });
  }
}
