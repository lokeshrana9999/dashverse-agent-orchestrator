// Layer `orch`: runChain with stub agents and real timers. Ordering, freezing,
// merging, timeouts and retries are orchestrator behaviour, not agent behaviour.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parallel, runChain, step } from "../src/orchestrator.ts";
import type { ChainResult, ParallelOptions } from "../src/types.ts";
import { provider, stub } from "./helpers/stub.ts";

const OPTIONS: ParallelOptions = { timeoutMs: 1000, minSuccesses: 1, retries: 1 };

async function timed<T>(work: Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await work;
  return { result, ms: performance.now() - started };
}

function resultsOf(result: ChainResult): Record<string, any> {
  return result.context.results as Record<string, any>;
}

describe("AC-1 labelled results", () => {
  test("TC-1.1 an error result stops the chain and names the error", async () => {
    const third = stub("third");
    const result = await runChain([step(stub("first")), step(stub("second", { error: "boom" })), step(third)], {});
    assert.equal(result.status, "error");
    assert.ok(result.status === "error" && result.error.includes("boom"));
    assert.equal(third.calls, 0);
    assert.equal(result.trace.entries.length, 2);
  });

  test("TC-1.2 a thrown bug becomes an error result naming the agent", async () => {
    const third = stub("third");
    const run = runChain([step(stub("first")), step(stub("second", { throws: "bug" })), step(third)], {});
    const result = await run; // resolves: a rejection would fail the test here
    assert.equal(result.status, "error");
    assert.ok(result.status === "error");
    assert.match(result.error, /second/);
    assert.match(result.error, /bug/);
    assert.equal(third.calls, 0);
  });
});

describe("AC-2 sequential flow and immutable context", () => {
  test("TC-2.1 context flows from agent 1 to agent 2", async () => {
    const second = stub("second");
    const result = await runChain([step(stub("first", { adds: { x: 1 } })), step(second)], {});
    assert.equal(second.inputs[0].x, 1);
    assert.equal(result.context.x, 1);
  });

  test("TC-2.2 agent 1's input is unchanged and frozen after the run", async () => {
    const input = { text: "hello", nested: { list: [1, 2] } };
    const snapshot = structuredClone(input);
    const first = stub("first", { adds: { x: 1 } });
    await runChain([step(first), step(stub("second", { adds: { y: 2 } }))], input);
    assert.deepEqual(first.inputs[0], snapshot);
    assert.deepEqual(input, snapshot);
    assert.ok(Object.isFrozen(input));
  });
});

describe("AC-4 merging parallel results", () => {
  test("TC-4.2 a provider cannot overwrite the request or another provider's slot", async () => {
    const request = { destination: "Tokyo" };
    const rogue = stub("A", {
      run: (context) => ({
        status: "ok",
        context: { ...context, request: { destination: "Hacked" }, results: { A: "offer A", B: "forged" } },
      }),
    });
    const result = await runChain(
      [
        step(stub("validator", { adds: { request } })),
        parallel([rogue, stub("B", { slot: "offer B" }), stub("C", { slot: "offer C" })], OPTIONS),
      ],
      {},
    );
    assert.equal(result.status, "ok");
    const [v2, v3] = result.trace.versions;
    assert.deepEqual(v3.request, v2.request);
    assert.equal(resultsOf(result).B, "offer B");
    assert.equal(resultsOf(result).A, "offer A");
    const entryA = result.trace.entries.find((entry) => entry.agent === "A");
    assert.deepEqual(entryA?.discarded, ["request", "results.B"]);
  });
});

describe("AC-6 per-provider timeout", () => {
  test("TC-6.1 a hanging agent's slot fails with timeout after the deadline", async () => {
    const { result, ms } = await timed(runChain([parallel([stub("A", { latencyMs: 5000 }), provider("B")], OPTIONS)], {}));
    assert.equal(resultsOf(result).A.failed, "timeout");
    assert.ok(ms >= 1000, `step took ${ms} ms`);
    assert.ok(ms < 1100, `step took ${ms} ms`);
  });

  test("TC-6.2 the deadline aborts the agent's signal and its cleanup runs once", async () => {
    const hanging = stub("A", { latencyMs: 5000 });
    await runChain([parallel([hanging, provider("B")], OPTIONS)], {});
    assert.equal(hanging.signals[0].aborted, true);
    assert.equal(hanging.cleanups, 1);
  });
});

describe("AC-7 one retry for errors, inside the deadline", () => {
  test("TC-7.2 an error is retried and the retry succeeds", async () => {
    const flaky = stub("A", [{ latencyMs: 300, error: "503" }, { latencyMs: 300, slot: "offer A" }]);
    const { result, ms } = await timed(runChain([parallel([flaky], OPTIONS)], {}));
    assert.equal(result.status, "ok");
    assert.equal(resultsOf(result).A, "offer A");
    assert.equal(result.trace.entries[0].attempts, 2);
    assert.ok(ms >= 600, `took ${ms} ms`);
    assert.ok(ms < 700, `took ${ms} ms`);
  });
});

describe("AC-1 labelled results (P1)", () => {
  test("TC-1.3 needs_clarification passes through unchanged and stops the chain", async () => {
    const third = stub("third");
    const clarify = { missing: ["x"], question: "q?" };
    const result = await runChain([step(stub("first")), step(stub("second", { clarify })), step(third)], {});
    assert.equal(result.status, "needs_clarification");
    assert.ok(result.status === "needs_clarification");
    assert.deepEqual(result.missing, ["x"]);
    assert.equal(result.question, "q?");
    assert.equal(third.calls, 0);
  });
});

describe("AC-2 immutable context (P1)", () => {
  test("TC-2.3 mutating the input throws TypeError and the stored version is unchanged", async () => {
    let caught: unknown;
    const mutator = stub("mutator", {
      run: (context) => {
        try {
          (context.parsed as { city: string }).city = "X";
        } catch (error) {
          caught = error;
        }
        return { status: "ok", context };
      },
    });
    const result = await runChain([step(stub("parser", { adds: { parsed: { city: "Paris" } } })), step(mutator)], {});
    assert.ok(caught instanceof TypeError, `caught ${String(caught)}`);
    assert.deepEqual(result.trace.versions[0].parsed, { city: "Paris" });
  });
});

describe("AC-3 parallel execution", () => {
  test("TC-3.2 three agents at 320, 180 and 250 ms overlap", async () => {
    const agents = [provider("A", 320), provider("B", 180), provider("C", 250)];
    const { result, ms } = await timed(runChain([parallel(agents, OPTIONS)], {}));
    assert.equal(result.status, "ok");
    assert.ok(ms >= 320, `took ${ms} ms`);
    assert.ok(ms < 450, `took ${ms} ms; sequential would be 750`);
  });

  test("TC-3.3 a fourth provider is one more list item", async () => {
    const agents = ["A", "B", "C", "D"].map((name) => provider(name, 10));
    const result = await runChain([parallel(agents, OPTIONS)], {});
    assert.deepEqual(Object.keys(resultsOf(result)), ["A", "B", "C", "D"]);
  });
});

describe("AC-4 merging parallel results (P1)", () => {
  test("TC-4.3 no provider sees another provider's result", async () => {
    const agents = [provider("A", 30), provider("B", 10), provider("C", 20)];
    await runChain([step(stub("validator", { adds: { request: {} } })), parallel(agents, OPTIONS)], {});
    for (const agent of agents) assert.equal(agent.inputs[0].results, undefined);
  });
});

describe("AC-5 minSuccesses", () => {
  const rows: Array<[minSuccesses: number, successes: number, expected: "error" | "ok"]> = [
    [1, 0, "error"],
    [1, 1, "ok"],
    [2, 1, "error"],
    [2, 2, "ok"],
    [2, 3, "ok"],
  ];
  for (const [minSuccesses, successes, expected] of rows) {
    test(`TC-5.5 minSuccesses ${minSuccesses} with ${successes} of 3 succeeding: ${expected === "ok" ? "continues" : "stops"}`, async () => {
      const agents = ["A", "B", "C"].map((name, index) =>
        index < successes ? provider(name) : stub(name, { error: "down" }),
      );
      const after = stub("aggregator");
      const result = await runChain([parallel(agents, { ...OPTIONS, retries: 0, minSuccesses }), step(after)], {});
      assert.equal(result.status, expected);
      assert.equal(after.calls, expected === "ok" ? 1 : 0);
    });
  }
});

describe("AC-6 per-provider timeout (P1)", () => {
  test("TC-6.4 900 ms answers inside a 1000 ms deadline, 1100 ms does not", async () => {
    const result = await runChain([parallel([provider("fast", 900), provider("slow", 1100)], OPTIONS)], {});
    assert.equal(resultsOf(result).fast.price, 100);
    assert.equal(resultsOf(result).slow.failed, "timeout");
  });

  test("TC-6.5 a timeout is never retried", async () => {
    const hanging = stub("A", { latencyMs: 5000 });
    const result = await runChain([parallel([hanging, provider("B")], OPTIONS)], {});
    assert.equal(result.trace.entries[0].attempts, 1);
    assert.equal(hanging.calls, 1);
  });
});

describe("AC-7 retry inside the deadline (P1, P2)", () => {
  test("TC-7.3 a retry that would overrun the deadline ends as timeout", async () => {
    const late = stub("A", [{ latencyMs: 950, error: "503" }, { latencyMs: 300, slot: "offer A" }]);
    const { result, ms } = await timed(runChain([parallel([late, provider("B")], OPTIONS)], {}));
    assert.equal(resultsOf(result).A.failed, "timeout");
    assert.equal(result.trace.entries[0].attempts, 2);
    assert.ok(ms < 1100, `took ${ms} ms`);
  });

  test("TC-7.4 an agent that always errors is tried exactly twice", async () => {
    const broken = stub("A", { latencyMs: 100, error: "503" });
    const result = await runChain([parallel([broken, provider("B")], OPTIONS)], {});
    assert.equal(resultsOf(result).A.failed, "error");
    assert.equal(result.trace.entries[0].attempts, 2);
    assert.equal(broken.calls, 2);
  });

  test("TC-7.5 retries: 0 means a single attempt", async () => {
    const once = stub("A", [{ error: "503" }, { slot: "offer A" }]);
    const result = await runChain([parallel([once, provider("B")], { ...OPTIONS, retries: 0 })], {});
    assert.equal(resultsOf(result).A.failed, "error");
    assert.equal(result.trace.entries[0].attempts, 1);
  });
});
