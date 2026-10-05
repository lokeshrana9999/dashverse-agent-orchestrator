// Stub agents for orchestrator tests: a set latency and a set result, with a
// record of every call. Waiting honours the AbortSignal and counts the cleanup.

import { sleep } from "../../src/timers.ts";
import type { Agent, AgentResult, Context } from "../../src/types.ts";

export const TODAY = "2026-10-05";

export interface StubBehaviour {
  latencyMs?: number;
  /** Keys merged into the context on success. */
  adds?: Record<string, unknown>;
  /** Written to `results.<name>` on success: how a parallel agent answers. */
  slot?: unknown;
  error?: string;
  throws?: string;
  clarify?: { missing: string[]; question: string };
  /** Full control: compute the result from the input. */
  run?: (context: Context) => AgentResult;
}

export class StubAgent implements Agent {
  readonly name: string;
  readonly #behaviours: StubBehaviour[];
  calls = 0;
  inputs: Context[] = [];
  signals: AbortSignal[] = [];
  /** How many times an abort cancelled this stub's pending timer. */
  cleanups = 0;

  /** Pass an array to vary behaviour per call; the last one repeats. */
  constructor(name: string, behaviour: StubBehaviour | StubBehaviour[] = {}) {
    this.name = name;
    this.#behaviours = Array.isArray(behaviour) ? behaviour : [behaviour];
  }

  async run(context: Context, signal: AbortSignal): Promise<AgentResult> {
    const behaviour = this.#behaviours[Math.min(this.calls, this.#behaviours.length - 1)];
    this.calls += 1;
    this.inputs.push(context);
    this.signals.push(signal);

    if (behaviour.latencyMs) {
      try {
        await sleep(behaviour.latencyMs, signal);
      } catch (reason) {
        this.cleanups += 1;
        throw reason;
      }
    }

    if (behaviour.run) return behaviour.run(context);
    if (behaviour.throws) throw new Error(behaviour.throws);
    if (behaviour.error) return { status: "error", error: behaviour.error };
    if (behaviour.clarify) return { status: "needs_clarification", ...behaviour.clarify };

    const results = behaviour.slot === undefined
      ? {}
      : { results: { ...(context.results as object | undefined), [this.name]: behaviour.slot } };
    return { status: "ok", context: { ...context, ...behaviour.adds, ...results } };
  }
}

export function stub(name: string, behaviour?: StubBehaviour | StubBehaviour[]): StubAgent {
  return new StubAgent(name, behaviour);
}

/** A provider-like stub that answers `{ price }` in its own slot after `latencyMs`. */
export function provider(name: string, latencyMs = 0, behaviour: StubBehaviour = {}): StubAgent {
  return new StubAgent(name, { latencyMs, slot: { provider: name, price: 100 }, ...behaviour });
}
