// Turns the providers' slots into one decision: every offer ranked, the
// cheapest first. Failed slots are skipped; the parallel step has already
// guaranteed at least one offer.

import { isFailure } from "../types.ts";
import type { Agent, AgentResult, Offer, TravelContext } from "../types.ts";

export class AggregatorAgent implements Agent<TravelContext> {
  readonly name = "aggregator";

  async run(context: TravelContext): Promise<AgentResult<TravelContext>> {
    const offers = Object.values(context.results ?? {}).filter((slot) => !isFailure(slot)) as Offer[];
    if (offers.length === 0) return { status: "error", error: "no offers to compare" };

    const ranked = rankOffers(offers);
    const best = { provider: ranked[0].provider, ranked };
    return { status: "ok", context: { ...context, best } };
  }
}

/** Cheapest first; ties go to the shorter trip, then the provider name, so the order is stable. */
export function rankOffers(offers: readonly Offer[]): Offer[] {
  return [...offers].sort(
    (a, b) =>
      a.price - b.price ||
      (a.durationMin ?? 0) - (b.durationMin ?? 0) ||
      a.provider.localeCompare(b.provider),
  );
}
