// One class, one instance per provider. The agent adapts a provider API to the
// agent interface: it reads the validated request and writes only its own slot,
// `results.<name>`. It knows nothing about the other providers, timeouts or
// retries; the parallel step owns those.

import type { Agent, AgentResult, Offer, TravelContext, TravelRequest } from "../types.ts";

/** The external call. Mocked in this project (see scenarios.ts). */
export interface ProviderApi {
  search(request: TravelRequest, signal: AbortSignal): Promise<Omit<Offer, "provider">>;
}

export class ProviderAgent implements Agent<TravelContext> {
  readonly name: string;
  readonly #api: ProviderApi;

  constructor(name: string, api: ProviderApi) {
    this.name = name;
    this.#api = api;
  }

  async run(context: TravelContext, signal: AbortSignal): Promise<AgentResult<TravelContext>> {
    if (!context.request) return { status: "error", error: "no validated request to search for" };
    try {
      const offer: Offer = { provider: this.name, ...(await this.#api.search(context.request, signal)) };
      return { status: "ok", context: { ...context, results: { ...context.results, [this.name]: offer } } };
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
