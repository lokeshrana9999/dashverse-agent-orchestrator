// Layer `unit`: the timeline printer on a fixed trace, compared to a stored
// string so any change to the layout is visible in review.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTimeline } from "../src/timeline.ts";
import type { EntryStatus, Trace, TraceEntry } from "../src/types.ts";

function provider(agent: string, endMs: number, status: EntryStatus): TraceEntry {
  return { agent, step: 3, group: 3, startMs: 0, endMs, status, attempts: 1, inputVersion: 2, added: [] };
}

test("TC-13.5 timeline of a parallel group with one timeout", () => {
  const trace: Trace = {
    input: {},
    versions: [],
    entries: [provider("A", 320, "ok"), provider("B", 180, "ok"), provider("C", 1000, "timeout")],
    totalMs: 1001,
    sumMs: 1500,
  };
  const expected = [
    "step   agent       |0 ms                             1001 ms|",
    "   3 / A           |=============                           |   320 ms  ok",
    "   3 | B           |=======                                 |   180 ms  ok",
    "   3 \\ C           |========================================|  1000 ms  timeout",
    "total 1001 ms (sum of agents 1500 ms) - group 3 ran in parallel",
  ].join("\n");
  assert.equal(formatTimeline(trace), expected);
});
