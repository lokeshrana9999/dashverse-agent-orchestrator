// Layer `unit`: the parser on its own. today is 2026-10-05 (a Monday) unless
// a row says otherwise; an absent field means the key is not set at all.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ParserAgent, parseRequest } from "../src/agents/parser.ts";
import type { Parsed } from "../src/types.ts";
import { TODAY } from "./helpers/stub.ts";

const CASES: Array<[id: string, text: string, today: string, expected: Parsed]> = [
  ["TC-8.1", "Book a flight to Tokyo for December 1st", TODAY, { type: "flight", destination: "Tokyo", date: "2026-12-01" }],
  ["TC-8.2", "Book me a flight to Paris next Friday", TODAY, { type: "flight", destination: "Paris", date: "2026-10-09" }],
  ["TC-8.3", "I want to travel next month", TODAY, { date: "2026-11" }],
  ["TC-8.4", "Book a hotel in Paris next Friday", TODAY, { type: "hotel", destination: "Paris", date: "2026-10-09" }],
  ["TC-8.5", "Fly from Boston to New York on Dec 1", TODAY, { type: "flight", destination: "New York", date: "2026-12-01", origin: "Boston" }],
  ["TC-8.6", "Book a flight to Tokyo tomorrow", TODAY, { type: "flight", destination: "Tokyo", date: "2026-10-06" }],
  ["TC-8.7", "Book a flight to Tokyo on 2026-12-01", TODAY, { type: "flight", destination: "Tokyo", date: "2026-12-01" }],
  ["TC-8.8", "Book a flight to Tokyo someday", TODAY, { type: "flight", destination: "Tokyo" }],
  ["TC-8.9", "Book a flight to Tokyo for October 5th", TODAY, { type: "flight", destination: "Tokyo", date: "2026-10-05" }],
  ["TC-8.10", "Book a flight to Tokyo for October 4th", TODAY, { type: "flight", destination: "Tokyo", date: "2027-10-04" }],
  ["TC-8.11", "Book a flight to Tokyo for October 6th", TODAY, { type: "flight", destination: "Tokyo", date: "2026-10-06" }],
  ["TC-8.12", "Book a flight to tokyo next Friday", TODAY, { type: "flight", date: "2026-10-09" }],
  ["TC-8.13", "Book me a flight to Paris next Friday", "2026-10-09", { type: "flight", destination: "Paris", date: "2026-10-16" }],
  ["TC-8.14", "Book me a flight to Paris next Friday", "2026-10-08", { type: "flight", destination: "Paris", date: "2026-10-09" }],
  ["TC-8.15", "Book a flight to Tokyo for December 1st", "2026-12-02", { type: "flight", destination: "Tokyo", date: "2027-12-01" }],
  ["TC-8.16", "I want to travel next month", "2026-12-15", { date: "2027-01" }],
  ["TC-8.17", "Book a stay in Paris next Friday", TODAY, { type: "hotel", destination: "Paris", date: "2026-10-09" }],
];

describe("AC-8 parser", () => {
  for (const [id, text, today, expected] of CASES) {
    test(`${id} "${text}" (today ${today})`, () => {
      assert.deepEqual(parseRequest(text, today), expected);
    });
  }

  test("ParserAgent returns ok with a new context holding parsed", async () => {
    const input = Object.freeze({ text: "Book a flight to Tokyo for December 1st" });
    const result = await new ParserAgent({ today: TODAY }).run(input);
    assert.equal(result.status, "ok");
    assert.ok(result.status === "ok");
    assert.notEqual(result.context, input);
    assert.deepEqual(result.context.parsed, { type: "flight", destination: "Tokyo", date: "2026-12-01" });
  });
});
