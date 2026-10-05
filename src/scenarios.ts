// Mock provider APIs and the named scenarios that configure them. These stand
// in for the external HTTP calls; the agents and the orchestrator are real.

import type { ProviderApi } from "./agents/provider.ts";
import { sleep } from "./timers.ts";
import type { Offer, TravelRequest, TravelType } from "./types.ts";

/**
 * `ok` answers after its latency; `error` fails after its latency on every
 * attempt; `timeout` hangs for 5 s (longer than any deadline); `flaky` fails
 * its first call and answers the second.
 */
export type Behaviour = "ok" | "error" | "timeout" | "flaky";

const HANG_MS = 5000;

type MockOffer = Omit<Offer, "provider">;

interface ProviderProfile {
  latencyMs: number;
  offers: Record<TravelType, MockOffer>;
}

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  A: {
    latencyMs: 320,
    offers: {
      flight: { name: "Air France", price: 450, durationMin: 450, stops: 0 },
      hotel: { name: "Park Hyatt", price: 310 },
    },
  },
  B: {
    latencyMs: 180,
    offers: {
      flight: { name: "Delta", price: 520, durationMin: 410, stops: 0 },
      hotel: { name: "Hilton", price: 240 },
    },
  },
  C: {
    latencyMs: 250,
    offers: {
      flight: { name: "United", price: 480, durationMin: 550, stops: 1 },
      hotel: { name: "Marriott", price: 270 },
    },
  },
};

export const SCENARIOS = {
  happy: { A: "ok", B: "ok", C: "ok" },
  "partial-failure": { A: "ok", B: "ok", C: "timeout" },
  "all-fail": { A: "error", B: "timeout", C: "error" },
  flaky: { A: "ok", B: "flaky", C: "ok" },
} as const satisfies Record<string, Record<string, Behaviour>>;

export type ScenarioName = keyof typeof SCENARIOS;
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export function isScenarioName(name: string): name is ScenarioName {
  return Object.hasOwn(SCENARIOS, name);
}

/** A fake provider API with a fixed latency, offer and behaviour. Counts its calls. */
export class MockProviderApi implements ProviderApi {
  calls = 0;
  readonly #name: string;
  readonly #behaviour: Behaviour;
  readonly #profile: ProviderProfile;

  constructor(name: string, behaviour: Behaviour, profile: ProviderProfile) {
    this.#name = name;
    this.#behaviour = behaviour;
    this.#profile = profile;
  }

  async search(request: TravelRequest, signal: AbortSignal): Promise<MockOffer> {
    this.calls += 1;
    if (this.#behaviour === "timeout") {
      await sleep(HANG_MS, signal);
    } else {
      await sleep(this.#profile.latencyMs, signal);
    }
    const fails = this.#behaviour === "error" || (this.#behaviour === "flaky" && this.calls === 1);
    if (fails) throw new Error(`provider ${this.#name} answered 503 Service Unavailable`);
    return this.#profile.offers[request.type];
  }
}

/**
 * One mock API per provider, configured by behaviour:
 * `mockProviders(SCENARIOS.happy)` or a custom `{ A: "ok", B: "ok", C: "error" }`.
 */
export function mockProviders(behaviours: Readonly<Record<string, Behaviour>>): Record<string, MockProviderApi> {
  return Object.fromEntries(
    Object.entries(behaviours).map(([name, behaviour]) => {
      const profile = PROVIDER_PROFILES[name];
      if (!profile) throw new Error(`no mock profile for provider ${name}`);
      return [name, new MockProviderApi(name, behaviour, profile)];
    }),
  );
}
