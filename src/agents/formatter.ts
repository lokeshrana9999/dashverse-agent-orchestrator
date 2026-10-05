// Writes the reply: a summary line with the best offer, the comparison rows,
// and a note naming any provider that didn't answer.

import { comparisonRows, missingProvidersNote, summaryLine } from "../messages.ts";
import { isFailure } from "../types.ts";
import type { Agent, AgentResult, SlotFailure, TravelContext } from "../types.ts";

export class FormatterAgent implements Agent<TravelContext> {
  readonly name = "formatter";

  async run(context: TravelContext): Promise<AgentResult<TravelContext>> {
    const { request, best, results = {} } = context;
    if (!request || !best) return { status: "error", error: "nothing to format: request or best offer missing" };

    const failures: Record<string, SlotFailure> = {};
    for (const [provider, slot] of Object.entries(results)) {
      if (isFailure(slot)) failures[provider] = slot;
    }

    const lines = [
      summaryLine(request, best.ranked.length, best.ranked[0]),
      ...comparisonRows(best.ranked, request.type),
    ];
    if (Object.keys(failures).length > 0) lines.push(missingProvidersNote(failures));
    return { status: "ok", context: { ...context, reply: lines.join("\n") } };
  }
}
