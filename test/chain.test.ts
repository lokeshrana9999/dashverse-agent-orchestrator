// Layer `chain`: the real agents and the scenario mocks through runChain,
// with today fixed at 2026-10-05 (a Monday). These are the problem
// statement's four test cases, end to end.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { travelChain } from "../src/chain.ts";
import { runChain } from "../src/orchestrator.ts";
import { SCENARIOS, mockProviders, type Behaviour } from "../src/scenarios.ts";
import type { ChainResult, ProviderSlot, TravelContext } from "../src/types.ts";
import { TODAY } from "./helpers/stub.ts";

const TOKYO = "Book a flight to Tokyo for December 1st";

async function plan(text: string, behaviours: Readonly<Record<string, Behaviour>>) {
  const providers = mockProviders(behaviours);
  const result = await runChain(travelChain({ today: TODAY, providers }), { text } as TravelContext);
  return { result, providers };
}

function entry(result: ChainResult<TravelContext>, agent: string) {
  const found = result.trace.entries.find((candidate) => candidate.agent === agent);
  assert.ok(found, `no trace entry for ${agent}`);
  return found;
}

function results(result: ChainResult<TravelContext>): Record<string, ProviderSlot> {
  return result.context.results ?? {};
}

describe("statement test case 1: happy path", () => {
  test("TC-5.1 all providers answer and the cheapest wins", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    assert.equal(result.status, "ok");
    const slots = results(result);
    assert.equal(Object.values(slots).filter((slot) => !("failed" in slot)).length, 3);
    assert.equal(result.context.best?.provider, "A");
  });

  test("TC-3.1 providers start together and the run is shorter than the sum of agents", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    const starts = ["A", "B", "C"].map((name) => entry(result, name).startMs);
    assert.ok(Math.max(...starts) - Math.min(...starts) < 20, `starts ${starts}`);
    assert.ok(result.trace.totalMs < 450, `total ${result.trace.totalMs}`);
    assert.ok(result.trace.totalMs < result.trace.sumMs);
  });

  test("TC-4.1 results are keyed by provider in chain order, not finish order", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    assert.deepEqual(Object.keys(result.trace.versions[2].results ?? {}), ["A", "B", "C"]);
  });

  test("TC-13.1 the trace lists every agent in order, providers sharing step 3", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    const rows = result.trace.entries.map(({ agent, step, group, status }) => ({ agent, step, group, status }));
    assert.deepEqual(rows, [
      { agent: "parser", step: 1, group: undefined, status: "ok" },
      { agent: "validator", step: 2, group: undefined, status: "ok" },
      { agent: "A", step: 3, group: 3, status: "ok" },
      { agent: "B", step: 3, group: 3, status: "ok" },
      { agent: "C", step: 3, group: 3, status: "ok" },
      { agent: "aggregator", step: 4, group: undefined, status: "ok" },
      { agent: "formatter", step: 5, group: undefined, status: "ok" },
    ]);
  });
});

describe("statement test case 2: partial failure", () => {
  test("TC-5.2 C times out; the chain continues with A and B and notes C", async () => {
    const { result } = await plan(TOKYO, SCENARIOS["partial-failure"]);
    assert.equal(result.status, "ok");
    assert.equal(result.context.best?.provider, "A");
    assert.ok(result.context.reply?.endsWith("Note: Provider C didn't respond (timeout)"));
    assert.equal(entry(result, "C").status, "timeout");
    assert.ok(result.trace.totalMs >= 1000, `total ${result.trace.totalMs}`);
    assert.ok(result.trace.totalMs < 1200, `total ${result.trace.totalMs}`);
  });

  test("TC-5.3 C errors instead; it is retried once and the chain continues", async () => {
    const { result } = await plan(TOKYO, { ...SCENARIOS["partial-failure"], C: "error" });
    assert.equal(result.status, "ok");
    assert.equal((results(result).C as { failed: string }).failed, "error");
    assert.equal(entry(result, "C").attempts, 2);
    assert.ok(result.trace.totalMs < 700, `total ${result.trace.totalMs}`);
  });
});

describe("statement test case 3: all providers fail", () => {
  test("TC-5.4 all providers fail: a clear error, in about one second", async () => {
    const { result } = await plan(TOKYO, SCENARIOS["all-fail"]);
    assert.equal(result.status, "error");
    assert.ok(result.status === "error");
    assert.equal(result.error, "Couldn't reach any flight provider (A: error, B: timeout, C: error). Please try again.");
    const agents = result.trace.entries.map((candidate) => candidate.agent);
    assert.ok(!agents.includes("aggregator") && !agents.includes("formatter"));
    assert.ok(result.trace.totalMs >= 990, `total ${result.trace.totalMs}`);
    assert.ok(result.trace.totalMs < 1200, `total ${result.trace.totalMs}`);
  });
});

describe("retry", () => {
  test("TC-7.1 flaky: B fails once, succeeds on attempt 2", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.flaky);
    assert.equal(result.status, "ok");
    assert.equal(result.context.best?.ranked.length, 3);
    assert.equal(entry(result, "B").attempts, 2);
    assert.ok(result.trace.totalMs < 500, `total ${result.trace.totalMs}`);
  });
});

describe("statement test case 4: missing information", () => {
  test("TC-12.1 missing destination and type stops before any provider", async () => {
    const { result, providers } = await plan("I want to travel next month", SCENARIOS.happy);
    assert.equal(result.status, "needs_clarification");
    assert.ok(result.status === "needs_clarification");
    assert.deepEqual(result.missing, ["destination", "type"]);
    for (const api of Object.values(providers)) assert.equal(api.calls, 0);
    assert.deepEqual(result.trace.entries.map((candidate) => candidate.agent), ["parser", "validator"]);
    assert.equal(result.trace.versions.length, 1);
  });
});

describe("context versions and merging (P1)", () => {
  test("TC-2.4 happy: five versions, each adding one key", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    const { input, versions } = result.trace;
    assert.equal(versions.length, 5);
    const added = versions.map((version, index) => {
      const before = Object.keys(index === 0 ? input : versions[index - 1]);
      return Object.keys(version).filter((key) => !before.includes(key));
    });
    assert.deepEqual(added, [["parsed"], ["request"], ["results"], ["best"], ["reply"]]);
  });

  test("TC-4.4 partial-failure: C's slot records the timeout and why", async () => {
    const { result } = await plan(TOKYO, SCENARIOS["partial-failure"]);
    const slot = results(result).C as { failed: string; detail: unknown };
    assert.equal(slot.failed, "timeout");
    assert.equal(typeof slot.detail, "string");
  });

  test("TC-5.6 A ok, B timeout, C error: continues with A and notes both", async () => {
    const { result } = await plan(TOKYO, { A: "ok", B: "timeout", C: "error" });
    assert.equal(result.status, "ok");
    assert.equal(result.context.best?.provider, "A");
    assert.ok(result.context.reply?.endsWith("Note: Providers B (timeout) and C (error) didn't respond"), result.context.reply);
  });

  test("TC-12.2 missing information returns at once: nobody waited on a provider", async () => {
    const { result } = await plan("I want to travel next month", SCENARIOS.happy);
    assert.ok(result.trace.totalMs < 50, `total ${result.trace.totalMs}`);
  });
});

describe("trace and observability (P1, P2)", () => {
  test("TC-13.2 each entry records exactly what its agent added", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    const added = Object.fromEntries(result.trace.entries.map((candidate) => [candidate.agent, candidate.added]));
    assert.deepEqual(added, {
      parser: ["parsed"],
      validator: ["request"],
      A: ["results.A"],
      B: ["results.B"],
      C: ["results.C"],
      aggregator: ["best"],
      formatter: ["reply"],
    });
  });

  test("TC-13.3 sumMs is the sum of agent durations and exceeds totalMs", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    const { entries, sumMs, totalMs } = result.trace;
    assert.equal(sumMs, entries.reduce((sum, candidate) => sum + candidate.endMs - candidate.startMs, 0));
    assert.ok(totalMs < sumMs, `total ${totalMs}, sum ${sumMs}`);
  });

  test("TC-13.4 flaky: only B took two attempts", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.flaky);
    for (const candidate of result.trace.entries) {
      assert.equal(candidate.attempts, candidate.agent === "B" ? 2 : 1, candidate.agent);
    }
  });

  test("TC-13.6 the deterministic agents each take under 50 ms", async () => {
    const { result } = await plan(TOKYO, SCENARIOS.happy);
    for (const agent of ["parser", "validator", "aggregator", "formatter"]) {
      const { startMs, endMs } = entry(result, agent);
      assert.ok(endMs - startMs < 50, `${agent} took ${endMs - startMs} ms`);
    }
  });
});
