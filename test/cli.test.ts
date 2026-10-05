// Layer `cli`: `node src/main.ts` as a child process. Exit codes, flags, and
// that no leftover timer keeps the process alive.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TODAY } from "./helpers/stub.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKYO = "Book a flight to Tokyo for December 1st";

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function cli(...args: string[]): Promise<CliRun> {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, ["src/main.ts", ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
  });
}

describe("CLI", () => {
  test("TC-14.1 happy run: exit 0, the reply and the parallel footer", async () => {
    const run = await cli(TOKYO, "--scenario", "happy", "--today", TODAY);
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.stdout.includes("I found 3 flights to Tokyo on Dec 1. Best: Air France $450 (7h 30m, direct)"));
    assert.match(run.stdout, /group 3 ran in parallel/);
  });

  test("TC-6.3 all-fail: the process exits promptly, no 5 s timer left alive", async () => {
    const run = await cli(TOKYO, "--scenario", "all-fail", "--today", TODAY);
    assert.ok(run.ms < 1500, `process took ${Math.round(run.ms)} ms`);
  });
});

describe("CLI (P1, P2)", () => {
  test("TC-14.2 missing information: exit 2 and the question", async () => {
    const run = await cli("I want to travel next month", "--scenario", "happy", "--today", TODAY);
    assert.equal(run.code, 2, run.stderr);
    assert.ok(run.stdout.includes("Where to, and flight or hotel?"));
  });

  test("TC-14.3 --trace-json: stdout is the trace as JSON", async () => {
    const run = await cli(TOKYO, "--scenario", "happy", "--today", TODAY, "--trace-json");
    assert.equal(run.code, 0, run.stderr);
    const trace = JSON.parse(run.stdout);
    assert.equal(trace.versions.length, 5);
    assert.equal(trace.entries.length, 7);
  });

  test("TC-14.4 all-fail: exit 1 and the stop error", async () => {
    const run = await cli(TOKYO, "--scenario", "all-fail", "--today", TODAY);
    assert.equal(run.code, 1);
    assert.ok(run.stdout.includes("Couldn't reach any flight provider (A: error, B: timeout, C: error). Please try again."));
  });

  test("TC-14.5 unknown scenario: exit 1, lists the scenarios, prints no trace", async () => {
    const run = await cli(TOKYO, "--scenario", "nope");
    assert.equal(run.code, 1);
    assert.ok(run.stderr.includes("happy, partial-failure, all-fail, flaky"), run.stderr);
    assert.equal(run.stdout, "");
  });

  test("TC-14.6 no text, or an invalid --today: exit 1 with the reason", async () => {
    const noText = await cli("--scenario", "happy");
    assert.equal(noText.code, 1);
    assert.match(noText.stderr, /usage:/);

    const badDay = await cli(TOKYO, "--today", "2026-13-45");
    assert.equal(badDay.code, 1);
    assert.match(badDay.stderr, /invalid --today/);
  });
});
