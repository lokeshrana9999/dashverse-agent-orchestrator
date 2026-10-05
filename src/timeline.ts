// Human-readable views of a trace: one log line per agent as it finishes, and
// a timeline that draws every agent as a bar on a shared millisecond axis, so
// agents that overlapped are visibly side by side.

import type { ParallelOptions, Trace, TraceEntry } from "./types.ts";

const BAR_WIDTH = 40;

function readVersion(version: number): string {
  return version === 0 ? "input" : `v${version}`;
}

/** `[3] A  ok  320 ms  attempt 1/2  read v2  added results.A = {...}` */
export function describeEntry(entry: TraceEntry, maxAttempts?: number): string {
  const parts = [
    `[${entry.step}] ${entry.agent.padEnd(10)}`,
    entry.status.padEnd(7),
    `${String(entry.endMs - entry.startMs).padStart(4)} ms`,
  ];
  if (maxAttempts !== undefined) parts.push(`attempt ${entry.attempts}/${maxAttempts}`);
  parts.push(`read ${readVersion(entry.inputVersion)}`);
  if (entry.error !== undefined) parts.push(entry.error);
  for (const [key, value] of Object.entries(entry.output ?? {})) {
    parts.push(entry.status === "ok" ? `added ${key} = ${JSON.stringify(value)}` : `${key} = ${JSON.stringify(value)}`);
  }
  if (entry.discarded) parts.push(`discarded writes to ${entry.discarded.join(", ")}`);
  return parts.join("  ");
}

export function describeParallelStart(
  step: number,
  agents: readonly string[],
  options: Pick<ParallelOptions, "timeoutMs" | "retries" | "minSuccesses">,
): string {
  return (
    `[${step}] running ${agents.join(", ")} in parallel ` +
    `(timeout ${options.timeoutMs} ms each, ${options.retries} ${options.retries === 1 ? "retry" : "retries"} on error, need ${options.minSuccesses})`
  );
}

/** Bracket drawn beside the agents of one parallel group: / | \ */
function bracket(entries: readonly TraceEntry[], index: number): string {
  const group = entries[index].group;
  if (group === undefined) return " ";
  const first = entries[index - 1]?.group !== group;
  const last = entries[index + 1]?.group !== group;
  if (first && last) return "-";
  return first ? "/" : last ? "\\" : "|";
}

function bar(entry: TraceEntry, totalMs: number): string {
  const scale = BAR_WIDTH / Math.max(totalMs, 1);
  const from = Math.min(BAR_WIDTH - 1, Math.floor(entry.startMs * scale));
  const to = Math.min(BAR_WIDTH, Math.max(from + 1, Math.round(entry.endMs * scale)));
  return " ".repeat(from) + "=".repeat(to - from) + " ".repeat(BAR_WIDTH - to);
}

/**
 * step  agent       0 ms ... 1001 ms
 *    3 / A          |========          |  320 ms  ok
 * total 1001 ms (sum of agents 1500 ms) - group 3 ran in parallel
 */
export function formatTimeline(trace: Trace): string {
  const { entries, totalMs, sumMs } = trace;
  const axisEnd = `${totalMs} ms`;
  const header = `step   agent       |0 ms${axisEnd.padStart(BAR_WIDTH - 4)}|`;
  const rows = entries.map((entry, index) => {
    const duration = `${String(entry.endMs - entry.startMs).padStart(5)} ms`;
    const step = String(entry.step).padStart(4);
    return `${step} ${bracket(entries, index)} ${entry.agent.padEnd(11)} |${bar(entry, totalMs)}| ${duration}  ${entry.status}`;
  });

  const groups = [...new Set(entries.flatMap((entry) => (entry.group === undefined ? [] : [entry.group])))];
  const parallelNote =
    groups.length === 0 ? "" : ` - group${groups.length === 1 ? "" : "s"} ${groups.join(", ")} ran in parallel`;
  const footer = `total ${totalMs} ms (sum of agents ${sumMs} ms)${parallelNote}`;
  return [header, ...rows, footer].join("\n");
}
