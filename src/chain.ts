// The travel chain, as data: two sequential agents, one parallel group of
// providers, two more sequential agents. Adding a provider is one more entry
// in `providers`; the orchestrator does not change.

import { AggregatorAgent } from "./agents/aggregator.ts";
import { FormatterAgent } from "./agents/formatter.ts";
import { ParserAgent } from "./agents/parser.ts";
import { ProviderAgent, type ProviderApi } from "./agents/provider.ts";
import { ValidatorAgent } from "./agents/validator.ts";
import { MIN_PROVIDER_SUCCESSES, PROVIDER_RETRIES, PROVIDER_TIMEOUT_MS } from "./config.ts";
import { noProviderReached } from "./messages.ts";
import { parallel, step } from "./orchestrator.ts";
import type { Step, TravelContext } from "./types.ts";

export interface TravelChainConfig {
  /** `YYYY-MM-DD` that relative dates ("next Friday") resolve against. */
  today: string;
  /** Provider name to its API, in the order results are listed. */
  providers: Record<string, ProviderApi>;
  timeoutMs?: number;
}

export function travelChain({ today, providers, timeoutMs = PROVIDER_TIMEOUT_MS }: TravelChainConfig): Step<TravelContext>[] {
  const providerAgents = Object.entries(providers).map(([name, api]) => new ProviderAgent(name, api));
  return [
    step(new ParserAgent({ today })),
    step(new ValidatorAgent({ today })),
    parallel(providerAgents, {
      timeoutMs,
      retries: PROVIDER_RETRIES,
      minSuccesses: MIN_PROVIDER_SUCCESSES,
      failureMessage: (failures, context) => noProviderReached(context.request?.type ?? "flight", failures),
    }),
    step(new AggregatorAgent()),
    step(new FormatterAgent()),
  ];
}
