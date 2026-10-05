// Walks a chain of steps. Sequential steps hand one context to the next;
// a parallel step gives the same context to several agents at once, waits for
// all of them (each under its own deadline), and merges what they produced.
// Every agent call is wrapped, so the chain always ends with a labelled result.

import { timeoutDetail } from "./messages.ts";
import { describeEntry, describeParallelStart } from "./timeline.ts";
import { startTimer } from "./timers.ts";
import type {
  Agent,
  AgentResult,
  ChainResult,
  Context,
  ParallelOptions,
  SlotFailure,
  Step,
  Trace,
  TraceEntry,
} from "./types.ts";

export function step<C extends Context>(agent: Agent<C>): Step<C> {
  return { kind: "sequential", agent };
}

/** Agents that only read the incoming context and each write one slot, `results.<name>`. */
export function parallel<C extends Context>(agents: Agent<C>[], options: ParallelOptions<C>): Step<C> {
  return { kind: "parallel", agents, options };
}

export interface RunOptions {
  /** Receives one line as each agent finishes; the CLI prints them. */
  log?: (line: string) => void;
}

type StepOutcome<C extends Context> = { entries: TraceEntry[] } & (
  | { status: "ok"; context: C }
  | { status: "needs_clarification"; missing: string[]; question: string }
  | { status: "error"; error: string }
);

type Clock = () => number;

export async function runChain<C extends Context>(
  steps: readonly Step<C>[],
  input: C,
  { log = () => {} }: RunOptions = {},
): Promise<ChainResult<C>> {
  const started = performance.now();
  const clock: Clock = () => Math.round(performance.now() - started);
  const trace: Trace<C> = { input: deepFreeze(input), versions: [], entries: [], totalMs: 0, sumMs: 0 };
  let context = trace.input;

  for (const [index, current] of steps.entries()) {
    const at = { step: index + 1, inputVersion: trace.versions.length, clock, log };
    const outcome =
      current.kind === "sequential"
        ? await runSequential(current.agent, context, at)
        : await runParallel(current.agents, current.options, context, at);
    trace.entries.push(...outcome.entries);

    if (outcome.status !== "ok") {
      finishTrace(trace, clock);
      if (outcome.status === "error") {
        log(`chain stopped at step ${at.step}: ${outcome.error}`);
        return { status: "error", context, error: outcome.error, trace };
      }
      return { status: "needs_clarification", context, missing: outcome.missing, question: outcome.question, trace };
    }

    context = deepFreeze(outcome.context);
    trace.versions.push(context);
  }

  finishTrace(trace, clock);
  return { status: "ok", context, trace };
}

interface StepPosition {
  step: number;
  inputVersion: number;
  clock: Clock;
  log: (line: string) => void;
}

// ------------------------------------------------------------ sequential --

async function runSequential<C extends Context>(
  agent: Agent<C>,
  input: C,
  { step, inputVersion, clock, log }: StepPosition,
): Promise<StepOutcome<C>> {
  const startMs = clock();
  const result = await callSafely(agent, input, new AbortController().signal);
  const entry: TraceEntry = {
    agent: agent.name,
    step,
    startMs,
    endMs: clock(),
    status: result.status,
    attempts: 1,
    inputVersion,
    added: [],
  };
  if (result.status === "ok") {
    entry.added = changedKeys(input, result.context);
    entry.output = Object.fromEntries(entry.added.map((key) => [key, result.context[key]]));
  } else if (result.status === "error") {
    entry.error = result.error;
  } else {
    entry.output = { missing: result.missing, question: result.question };
  }
  log(describeEntry(entry));
  return { ...result, entries: [entry] };
}

// -------------------------------------------------------------- parallel --

interface ParallelRun {
  /** What goes in `results.<name>`: the agent's own slot, or why it has none. */
  slot: unknown;
  entry: TraceEntry;
}

async function runParallel<C extends Context>(
  agents: readonly Agent<C>[],
  options: ParallelOptions<C>,
  input: C,
  position: StepPosition,
): Promise<StepOutcome<C>> {
  const { step, log } = position;
  log(describeParallelStart(step, agents.map((agent) => agent.name), options));

  // Every agent starts now, on the same frozen input. runWithDeadline never
  // rejects (a crash or a timeout becomes a failure slot), so Promise.all
  // waits for every agent and each is bounded by its own deadline.
  const runs = await Promise.all(
    agents.map(async (agent) => {
      const run = await runWithDeadline(agent, input, options, position);
      log(describeEntry(run.entry, options.retries + 1));
      return run;
    }),
  );
  const entries = runs.map((run) => run.entry);

  const failures: Record<string, SlotFailure> = {};
  for (const run of runs) {
    if (run.entry.status !== "ok") failures[run.entry.agent] = run.slot as SlotFailure;
  }
  const successes = runs.length - Object.keys(failures).length;
  if (successes < options.minSuccesses) {
    const error =
      options.failureMessage?.(failures, input) ??
      `only ${successes} of ${runs.length} parallel agents succeeded; ${options.minSuccesses} needed`;
    return { status: "error", error, entries };
  }

  // The one merge point: the new version is built once, after every agent has
  // settled, from each agent's own slot. No agent saw another's output, and no
  // agent can overwrite another's slot or any other key.
  const earlier = (input.results ?? {}) as Record<string, unknown>;
  const slots = Object.fromEntries(runs.map((run) => [run.entry.agent, run.slot]));
  const context = { ...input, results: { ...earlier, ...slots } } as C;
  return { status: "ok", context, entries };
}

/** Resolves when the signal aborts; used to stop waiting on an agent that ignores it. */
const DEADLINE = Symbol("deadline");
function deadlineOf(signal: AbortSignal): Promise<typeof DEADLINE> {
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(DEADLINE), { once: true }));
}

/**
 * Runs one parallel agent under a single deadline covering all its attempts.
 * An `error` result is retried while time remains; a timeout is final. When the
 * deadline fires, the agent's signal aborts so it can cancel its own work, and
 * the orchestrator stops waiting whether or not the agent cooperates.
 */
async function runWithDeadline<C extends Context>(
  agent: Agent<C>,
  input: C,
  { timeoutMs, retries }: ParallelOptions<C>,
  { step, inputVersion, clock }: StepPosition,
): Promise<ParallelRun> {
  const startMs = clock();
  const controller = new AbortController();
  const cancelDeadline = startTimer(timeoutMs, () =>
    controller.abort(new DOMException(timeoutDetail(timeoutMs), "TimeoutError")),
  );
  const deadline = deadlineOf(controller.signal);
  let attempts = 0;

  const finish = (slot: unknown, extra: Partial<TraceEntry>): ParallelRun => {
    const entry: TraceEntry = {
      agent: agent.name,
      step,
      group: step,
      startMs,
      endMs: clock(),
      status: "ok",
      attempts,
      inputVersion,
      added: [],
      ...extra,
    };
    return { slot, entry };
  };
  const fail = (failed: SlotFailure["failed"], detail: string) =>
    finish({ failed, detail } satisfies SlotFailure, { status: failed, error: detail });

  try {
    while (true) {
      attempts += 1;
      const result = await Promise.race([callSafely(agent, input, controller.signal), deadline]);
      if (result === DEADLINE) return fail("timeout", timeoutDetail(timeoutMs));

      if (result.status === "ok") {
        const slotKey = `results.${agent.name}`;
        const slot = (result.context.results as Record<string, unknown> | undefined)?.[agent.name];
        if (slot === undefined) return fail("error", `${agent.name} returned no ${slotKey}`);
        const discarded = writtenKeys(input, result.context).filter((key) => key !== slotKey);
        return finish(slot, {
          added: [slotKey],
          output: { [slotKey]: slot },
          ...(discarded.length > 0 && { discarded }),
        });
      }

      // Only an `error` is retried. A provider asking for clarification fails at
      // once: asking again with the same input would get the same question.
      if (result.status === "needs_clarification") {
        return fail("error", `asked for clarification: ${result.question}`);
      }
      if (attempts > retries || controller.signal.aborted) return fail("error", result.error);
    }
  } finally {
    cancelDeadline();
  }
}

// --------------------------------------------------------------- helpers --

/** Calls an agent and turns a thrown bug into an `error` result naming the agent. */
async function callSafely<C extends Context>(agent: Agent<C>, input: C, signal: AbortSignal): Promise<AgentResult<C>> {
  try {
    return await agent.run(input, signal);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { status: "error", error: `${agent.name} crashed: ${message}` };
  }
}

/** Top-level keys whose value is new or replaced. */
function changedKeys(before: Context, after: Context): string[] {
  return Object.keys(after).filter((key) => after[key] !== before[key]);
}

/** Like changedKeys, but reports a changed `results` per slot: `results.A`. */
function writtenKeys(before: Context, after: Context): string[] {
  return changedKeys(before, after).flatMap((key) => {
    if (key !== "results") return [key];
    const old = (before.results ?? {}) as Record<string, unknown>;
    const now = (after.results ?? {}) as Record<string, unknown>;
    return Object.keys(now)
      .filter((name) => now[name] !== old[name])
      .map((name) => `results.${name}`);
  });
}

function finishTrace(trace: Trace<Context>, clock: Clock): void {
  trace.totalMs = clock();
  trace.sumMs = trace.entries.reduce((sum, entry) => sum + (entry.endMs - entry.startMs), 0);
}

/**
 * Freezes a plain object graph in place. Each context version is frozen as it
 * is stored, so an agent that tries to mutate its input gets a TypeError
 * instead of silently changing what another agent reads.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
