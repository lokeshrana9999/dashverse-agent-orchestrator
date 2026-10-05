// Layer `unit`: validator, aggregator and formatter, each on a hand-built
// context. No timers, no orchestrator.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AggregatorAgent, rankOffers } from "../src/agents/aggregator.ts";
import { FormatterAgent } from "../src/agents/formatter.ts";
import { ValidatorAgent } from "../src/agents/validator.ts";
import { PROVIDER_PROFILES } from "../src/scenarios.ts";
import type { AgentResult, Offer, Parsed, ProviderSlot, TravelContext, TravelRequest, TravelType } from "../src/types.ts";
import { TODAY } from "./helpers/stub.ts";

function ok(result: AgentResult<TravelContext>): TravelContext {
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(result.status === "ok");
  return result.context;
}

function validate(parsed: Parsed) {
  return new ValidatorAgent({ today: TODAY }).run({ text: "", parsed });
}

/** The mock offer of each named provider, for one travel type. */
function offers(type: TravelType, names: string[]): Record<string, Offer> {
  return Object.fromEntries(names.map((name) => [name, { provider: name, ...PROVIDER_PROFILES[name].offers[type] }]));
}

async function aggregate(results: Record<string, ProviderSlot>) {
  return ok(await new AggregatorAgent().run({ text: "", results })).best!;
}

async function format(request: TravelRequest, results: Record<string, ProviderSlot>): Promise<string[]> {
  const ranked = rankOffers(Object.values(results).filter((slot): slot is Offer => !("failed" in slot)));
  const context: TravelContext = { text: "", request, results, best: { provider: ranked[0].provider, ranked } };
  return ok(await new FormatterAgent().run(context)).reply!.split("\n");
}

const TOKYO_DEC_1: TravelRequest = { destination: "Tokyo", date: "2026-12-01", type: "flight", origin: "NYC" };

describe("AC-9 validator", () => {
  test("TC-9.1 complete request: origin defaults to NYC", async () => {
    const context = ok(await validate({ destination: "Tokyo", date: "2026-12-01", type: "flight" }));
    assert.deepEqual(context.request, { destination: "Tokyo", date: "2026-12-01", type: "flight", origin: "NYC" });
  });

  test("TC-9.2 a stated origin is kept", async () => {
    const context = ok(await validate({ destination: "Tokyo", date: "2026-12-01", type: "flight", origin: "Boston" }));
    assert.equal(context.request?.origin, "Boston");
  });

  test("TC-9.3 only a month: asks for destination and type", async () => {
    const result = await validate({ date: "2026-11" });
    assert.equal(result.status, "needs_clarification");
    assert.ok(result.status === "needs_clarification");
    assert.deepEqual(result.missing, ["destination", "type"]);
    assert.equal(result.question, "Where to, and flight or hotel?");
  });

  test("TC-9.4 nothing parsed: asks for all three, in order", async () => {
    const result = await validate({});
    assert.ok(result.status === "needs_clarification");
    assert.deepEqual(result.missing, ["destination", "date", "type"]);
  });

  test("TC-9.5 no date: asks only for the date", async () => {
    const result = await validate({ destination: "Tokyo", type: "flight" });
    assert.ok(result.status === "needs_clarification");
    assert.deepEqual(result.missing, ["date"]);
  });

  test("TC-9.6 a date in the past is an error", async () => {
    const result = await validate({ destination: "Tokyo", date: "2020-12-01", type: "flight" });
    assert.equal(result.status, "error");
    assert.ok(result.status === "error");
    assert.equal(result.error, "date is in the past");
  });

  test("TC-9.7 a whole month is a valid date", async () => {
    const context = ok(await validate({ destination: "Tokyo", date: "2026-11", type: "flight" }));
    assert.equal(context.request?.date, "2026-11");
  });
});

describe("AC-10 aggregator", () => {
  test("TC-10.1 the three mock flights: Air France is cheapest", async () => {
    const best = await aggregate(offers("flight", ["A", "B", "C"]));
    assert.equal(best.provider, "A");
    assert.deepEqual(best.ranked.map((offer) => offer.provider), ["A", "C", "B"]);
  });

  test("TC-10.2 equal price: the shorter trip wins", async () => {
    const best = await aggregate({
      A: { provider: "A", name: "Slow", price: 450, durationMin: 450, stops: 0 },
      B: { provider: "B", name: "Fast", price: 450, durationMin: 410, stops: 0 },
    });
    assert.equal(best.ranked[0].durationMin, 410);
    assert.equal(best.provider, "B");
  });

  test("TC-10.3 equal price and duration: the provider name decides", async () => {
    const same = { name: "Same", price: 450, durationMin: 450, stops: 0 };
    const best = await aggregate({ B: { provider: "B", ...same }, A: { provider: "A", ...same } });
    assert.equal(best.provider, "A");
  });

  test("TC-10.4 failed slots are skipped", async () => {
    const best = await aggregate({
      ...offers("flight", ["A"]),
      B: { failed: "timeout", detail: "no answer within 1000 ms" },
      C: { failed: "error", detail: "503" },
    });
    assert.equal(best.provider, "A");
    assert.equal(best.ranked.length, 1);
  });

  test("TC-10.5 the three mock hotels: Hilton is cheapest", async () => {
    const best = await aggregate(offers("hotel", ["A", "B", "C"]));
    assert.equal(best.provider, "B");
    assert.deepEqual(best.ranked.map((offer) => offer.provider), ["B", "C", "A"]);
  });
});

describe("AC-11 formatter", () => {
  test("TC-11.1 three flights: summary, rows best first with gaps, no note", async () => {
    const lines = await format(TOKYO_DEC_1, offers("flight", ["A", "B", "C"]));
    assert.deepEqual(lines, [
      "I found 3 flights to Tokyo on Dec 1. Best: Air France $450 (7h 30m, direct)",
      "  A  Air France  $450  7h 30m  direct  <- best",
      "  C  United      $480  9h 10m  1 stop  +$30",
      "  B  Delta       $520  6h 50m  direct  +$70",
    ]);
    assert.ok(!lines.some((line) => line.startsWith("Note:")));
  });

  test("TC-11.2 two flights, C timed out: the last line names C", async () => {
    const lines = await format(TOKYO_DEC_1, {
      ...offers("flight", ["A", "B"]),
      C: { failed: "timeout", detail: "no answer within 1000 ms" },
    });
    assert.match(lines[0], /^I found 2 flights /);
    assert.equal(lines.at(-1), "Note: Provider C didn't respond (timeout)");
  });

  test("TC-11.3 one flight, B timed out and C errored: both named", async () => {
    const lines = await format(TOKYO_DEC_1, {
      ...offers("flight", ["A"]),
      B: { failed: "timeout", detail: "no answer within 1000 ms" },
      C: { failed: "error", detail: "503" },
    });
    assert.match(lines[0], /^I found 1 flight to Tokyo /);
    assert.equal(lines.at(-1), "Note: Providers B (timeout) and C (error) didn't respond");
  });

  test("TC-11.4 a whole month reads as 'in November 2026'", async () => {
    const lines = await format({ ...TOKYO_DEC_1, date: "2026-11" }, offers("flight", ["A", "B", "C"]));
    assert.ok(lines[0].includes("to Tokyo in November 2026"), lines[0]);
  });

  test("TC-11.5 three hotels: priced per night", async () => {
    const paris: TravelRequest = { destination: "Paris", date: "2026-10-09", type: "hotel", origin: "NYC" };
    const lines = await format(paris, offers("hotel", ["A", "B", "C"]));
    assert.equal(lines[0], "I found 3 hotels in Paris on Oct 9. Best: Hilton $240/night");
  });
});
