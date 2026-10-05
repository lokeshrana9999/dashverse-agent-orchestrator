// Timers that never fire early. Node schedules a timer from the event loop's
// cached clock, so after a busy loop turn a 1,000 ms timer can fire a few ms
// short of 1,000 ms of real time. These re-arm for any remainder, so a
// provider always gets its full deadline and a mock its full latency.

/** Calls `onDone` once `ms` of real time has passed. Returns a cancel function. */
export function startTimer(ms: number, onDone: () => void): () => void {
  const due = performance.now() + ms;
  let timer: ReturnType<typeof setTimeout>;
  const check = () => {
    const left = due - performance.now();
    if (left > 0) timer = setTimeout(check, Math.ceil(left));
    else onDone();
  };
  timer = setTimeout(check, ms);
  return () => clearTimeout(timer);
}

/**
 * Waits `ms`, or rejects with the signal's reason as soon as it aborts. Either
 * way the timer and the listener are removed, so nothing keeps Node alive.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      cancel();
      reject(signal.reason);
    };
    const cancel = startTimer(ms, () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
