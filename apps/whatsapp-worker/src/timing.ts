/** Node timers use a monotonic clock; recheck wall time to handle sleep and clock corrections. */
export function scheduleDeadline(scheduledAt: string, fire: () => void) {
  const target = Date.parse(scheduledAt);
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const wake = () => {
    if (cancelled) return;
    const remaining = target - Date.now();
    if (remaining <= 0) { fire(); return; }
    timer = setTimeout(wake, Math.min(remaining, 250));
  };
  timer = setTimeout(wake, Math.max(0, Math.min(target - Date.now(), 250)));
  return () => { cancelled = true; clearTimeout(timer); };
}
