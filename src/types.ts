// Shared contracts: the agent interface, chain steps, the trace, and the
// travel domain that flows through the context.

// ---------------------------------------------------------------- agents --

/** Any context is a plain, deeply frozen object. Agents never mutate it. */
export type Context = { readonly [key: string]: unknown };

/**
 * Every agent answers with a labelled result instead of throwing (decision 3).
 * Needing more information is not a failure, so it has its own label.
 */
export type AgentResult<C extends Context = Context> =
  | { status: "ok"; context: C }
  | { status: "needs_clarification"; missing: string[]; question: string }
  | { status: "error"; error: string };

export interface Agent<C extends Context = Context> {
  readonly name: string;
  /**
   * Reads `context` and returns a new context (never the same object mutated).
   * `signal` aborts when the orchestrator stops waiting (timeout); agents that
   * do I/O should pass it on so their timers and sockets are released.
   */
  run(context: C, signal: AbortSignal): Promise<AgentResult<C>>;
}

// ----------------------------------------------------------------- chain --

export interface ParallelOptions<C extends Context = Context> {
  /** One deadline per agent, shared by its first attempt and its retries. */
  timeoutMs: number;
  /** Fewer successful agents than this stops the chain with an error. */
  minSuccesses: number;
  /** Extra attempts after an `error` result; a timeout is never retried. */
  retries: number;
  /** Builds the stop message when too few agents succeed. */
  failureMessage?: (failures: Record<string, SlotFailure>, context: C) => string;
}

export type Step<C extends Context = Context> =
  | { kind: "sequential"; agent: Agent<C> }
  | { kind: "parallel"; agents: Agent<C>[]; options: ParallelOptions<C> };

/** How a parallel agent's slot in `results` records that it produced nothing. */
export interface SlotFailure {
  failed: "timeout" | "error";
  detail: string;
}

// ----------------------------------------------------------------- trace --

export type EntryStatus = "ok" | "needs_clarification" | "error" | "timeout";

export interface TraceEntry {
  agent: string;
  /** 1-based position in the chain; agents of one parallel step share it. */
  step: number;
  /** Set only for parallel agents: the step number of their group. */
  group?: number;
  /** Milliseconds since the chain started. */
  startMs: number;
  endMs: number;
  status: EntryStatus;
  attempts: number;
  /** Which context version the agent read: 0 is the chain input, n is v<n>. */
  inputVersion: number;
  /** Context keys this agent added or replaced, e.g. `["parsed"]` or `["results.A"]`. */
  added: string[];
  /** The values behind `added`, so a log line can show what the agent produced. */
  output?: Record<string, unknown>;
  /** Keys a parallel agent wrote outside its own slot; the orchestrator dropped them. */
  discarded?: string[];
  error?: string;
}

export interface Trace<C extends Context = Context> {
  input: C;
  /** v1, v2, ...: every context version handed from one step to the next. */
  versions: C[];
  entries: TraceEntry[];
  /** Wall-clock time of the whole chain. */
  totalMs: number;
  /** Sum of every agent's own duration; above `totalMs` when work overlapped. */
  sumMs: number;
}

export type ChainResult<C extends Context = Context> =
  | { status: "ok"; context: C; trace: Trace<C> }
  | { status: "needs_clarification"; context: C; missing: string[]; question: string; trace: Trace<C> }
  | { status: "error"; context: C; error: string; trace: Trace<C> };

// ---------------------------------------------------------------- travel --

export type TravelType = "flight" | "hotel";

/** What the parser read from the text; a key is absent when the text didn't say. */
export interface Parsed {
  type?: TravelType;
  destination?: string;
  /** `YYYY-MM-DD`, or `YYYY-MM` for a whole month ("next month"). */
  date?: string;
  origin?: string;
}

/** A complete, validated request: the validator's output. */
export interface TravelRequest {
  destination: string;
  date: string;
  type: TravelType;
  origin: string;
}

/** One provider's best offer. For hotels `price` is per night and there is no duration. */
export interface Offer {
  provider: string;
  name: string;
  price: number;
  durationMin?: number;
  stops?: number;
}

export type ProviderSlot = Offer | SlotFailure;

export interface Best {
  /** The winning provider; its offer is `ranked[0]`. */
  provider: string;
  /** Every offer, best first: price, then duration, then provider name. */
  ranked: Offer[];
}

export type TravelContext = {
  readonly text: string;
  readonly parsed?: Readonly<Parsed>;
  readonly request?: Readonly<TravelRequest>;
  readonly results?: Readonly<Record<string, ProviderSlot>>;
  readonly best?: Readonly<Best>;
  readonly reply?: string;
};

export function isFailure(slot: ProviderSlot | undefined): slot is SlotFailure {
  return slot !== undefined && "failed" in slot;
}
