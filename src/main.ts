// CLI: node src/main.ts "<text>" [--scenario <name>] [--today YYYY-MM-DD] [--trace-json]
// Exit codes: 0 reply given, 2 clarification needed, 1 stop error or bad arguments.

import { parseArgs } from "node:util";
import { travelChain } from "./chain.ts";
import { isIsoDay } from "./dates.ts";
import { USAGE, invalidToday, unknownScenario } from "./messages.ts";
import { runChain } from "./orchestrator.ts";
import { SCENARIOS, SCENARIO_NAMES, isScenarioName, mockProviders, type ScenarioName } from "./scenarios.ts";
import { formatTimeline } from "./timeline.ts";
import type { TravelContext } from "./types.ts";

interface CliOptions {
  text: string;
  scenario: ScenarioName;
  today: string;
  traceJson: boolean;
}

class UsageError extends Error {}

function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readOptions(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        scenario: { type: "string", default: "happy" },
        today: { type: "string" },
        "trace-json": { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const text = positionals.join(" ").trim();
  if (text === "") throw new UsageError("missing the request text");

  const scenario = String(values.scenario);
  if (!isScenarioName(scenario)) throw new UsageError(unknownScenario(scenario, SCENARIO_NAMES));

  const today = values.today === undefined ? localToday() : String(values.today);
  if (!isIsoDay(today)) throw new UsageError(invalidToday(today));

  return { text, scenario, today, traceJson: values["trace-json"] === true };
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = readOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }

  // With --trace-json, stdout carries only the JSON; the readable run goes to stderr.
  const stream = options.traceJson ? process.stderr : process.stdout;
  const print = (line = "") => stream.write(`${line}\n`);

  print(`> ${options.text}`);
  print(`  scenario ${options.scenario}, today ${options.today}`);
  print();

  const providers = mockProviders(SCENARIOS[options.scenario]);
  const chain = travelChain({ today: options.today, providers });
  const result = await runChain<TravelContext>(chain, { text: options.text }, { log: print });

  print();
  print(formatTimeline(result.trace));
  print();

  if (options.traceJson) process.stdout.write(`${JSON.stringify(result.trace, null, 2)}\n`);

  switch (result.status) {
    case "ok":
      print(result.context.reply);
      return 0;
    case "needs_clarification":
      print(`Need more information (${result.missing.join(", ")}): ${result.question}`);
      return 2;
    case "error":
      print(`Error: ${result.error}`);
      return 1;
  }
}

// Set the exit code instead of calling process.exit(): if a timer were left
// running, the process would visibly hang rather than hide the leak.
process.exitCode = await main(process.argv.slice(2));
