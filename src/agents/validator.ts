// Applies the fixed rules to what the parser read and owns the clarification
// gate: an incomplete request stops here, before any provider is called.

import { DEFAULT_ORIGIN } from "../config.ts";
import { isPast } from "../dates.ts";
import { PAST_DATE, clarificationQuestion } from "../messages.ts";
import type { Agent, AgentResult, Parsed, TravelContext } from "../types.ts";

/** Asked for in this order when missing. */
const REQUIRED = ["destination", "date", "type"] as const;

export class ValidatorAgent implements Agent<TravelContext> {
  readonly name = "validator";
  readonly #today: string;
  readonly #defaultOrigin: string;

  constructor({ today, defaultOrigin = DEFAULT_ORIGIN }: { today: string; defaultOrigin?: string }) {
    this.#today = today;
    this.#defaultOrigin = defaultOrigin;
  }

  async run(context: TravelContext): Promise<AgentResult<TravelContext>> {
    const parsed: Parsed = context.parsed ?? {};
    const missing = REQUIRED.filter((field) => parsed[field] === undefined);
    if (missing.length > 0) {
      return { status: "needs_clarification", missing, question: clarificationQuestion(missing) };
    }

    const { destination, date, type } = parsed as Required<typeof parsed>;
    if (isPast(date, this.#today)) return { status: "error", error: PAST_DATE };

    const request = { destination, date, type, origin: parsed.origin ?? this.#defaultOrigin };
    return { status: "ok", context: { ...context, request } };
  }
}
