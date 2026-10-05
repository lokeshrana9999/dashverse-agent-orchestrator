# Travel agent orchestrator

This orchestrator runs a travel request through seven agents. Three of them, the providers, run in parallel under a 1,000 ms deadline and survive partial failure. All four of the problem statement's test cases pass, and `examples/` holds the output of each run.

```
 user text
     |
     v
  parser --> validator --missing fields--> ask the user (exit 2)
                 |  v2, frozen
      +----------+----------+
      v          v          v       in parallel, 1,000 ms deadline
  provider A  provider B  provider C   each, 1 retry on error inside
      |          |          |
      +----------+----------+
                 |  merge once: results { A, B, C }
                 v
         0 succeeded? --yes--> stop error (exit 1)
                 | no
                 v
            aggregator --> formatter --> reply (exit 0)
```

## run it

Requires Node >= 23.6, which runs `.ts` files directly (tested on v24.19.0). There are no runtime dependencies.

1. Run `npm install`. It only installs `typescript`, which `npm run typecheck` needs.
2. Run `npm start -- "Book a flight to Tokyo for December 1st" --scenario partial-failure`. You should see C time out and the reply note it.
3. Run `npm test` (88 tests) and `npm run typecheck`.

| Flag | Effect |
|---|---|
| `--scenario <name>` | how the mock providers behave (default `happy`; see the table below) |
| `--today YYYY-MM-DD` | the date that "next Friday" or "December 1st" resolve against. The examples use `2026-10-05` |
| `--trace-json` | prints the full trace as JSON on stdout and moves the readable run to stderr |

| Scenario | A (320 ms) | B (180 ms) | C (250 ms) | Statement test case | Example |
|---|---|---|---|---|---|
| `happy` | ok | ok | ok | 1 | `examples/happy.txt` |
| `partial-failure` | ok | ok | timeout | 2 | `examples/partial-failure.txt` |
| `all-fail` | error | timeout | error | 3 | `examples/all-fail.txt` |
| `flaky` | ok | error, then ok | ok | retry | `examples/flaky.txt` |

Test case 4 isn't a scenario. It's the input "I want to travel next month", which stops at the validator (`examples/missing-info.txt`).

## agents and their one job each

Every agent implements one interface (`src/types.ts`). `run(context, signal)` resolves to `{ status: "ok", context }`, `{ status: "needs_clarification", missing, question }` or `{ status: "error", error }`.

| Agent | File | Job | Adds to context |
|---|---|---|---|
| parser | `src/agents/parser.ts` | Read the text into fields, recording only what the text says | `parsed` |
| validator | `src/agents/validator.ts` | Require destination, date and type; reject past dates; default origin to NYC; ask when something is missing | `request` |
| A, B, C | `src/agents/provider.ts` | Call one provider and write only its own slot | `results.<name>` |
| aggregator | `src/agents/aggregator.ts` | Rank offers by price, then duration, then provider name | `best` |
| formatter | `src/agents/formatter.ts` | Write the reply, the comparison and the note on missing providers | `reply` |

The chain itself is a list in `src/chain.ts`: `[step(parser), step(validator), parallel([A, B, C], options), step(aggregator), step(formatter)]`. The orchestrator in `src/orchestrator.ts` walks that list.

## why seven agents

The work splits into five jobs: read the text, check it, fetch offers, pick the best, and write the reply. Fetching runs once per provider, which makes seven agents from five classes. I separate two pieces of work when they change for different reasons, and keep them together when they always change together. That is why the aggregator and formatter are separate: the ranking can be tested without parsing a sentence. No agent calls an LLM, because what makes an agent here is its contract, not its contents.

## why parser and validator stay separate

The statement's example combines them to save communication overhead. Here that overhead is a 0 to 1 ms function call, so combining them saves nothing. Keeping them apart gives a clear boundary instead. The parser is the agent most likely to become an LLM call, while the validator applies fixed rules and decides when to ask the user. With the split, a new parser cannot change when the chain asks for clarification. If parsing stayed regex for good, I would merge them.

## only the providers run in parallel

The three providers read the same validated request, and none of them needs another's answer, so nothing forces an order between them. Every other agent needs the output of the step before it. In `examples/happy.txt` the chain finishes in 339 ms, against 777 ms of summed agent time.

## failures: best-effort with a deadline

A reply built from two providers is more useful than an error, so the chain continues with whichever providers answered. It stops only when fewer than `minSuccesses` (1) succeed, and the error then names each provider's failure.

Each provider has a single 1,000 ms deadline. When it fires, the provider's `AbortSignal` cancels its work, and a `Promise.race` releases the orchestrator even if the provider ignores the signal. An error is retried once within the same deadline. A timeout or a request for clarification is not retried, because a second call would get the same result. Node can fire a timer a few milliseconds early, so `src/timers.ts` re-arms it for the remainder.

## context is frozen, and each provider writes one slot

After every step the orchestrator deep-freezes the new context and keeps it as a version, v1 through v5. Freezing alone does not protect the parallel step. Node runs on one thread, but three providers that each read `results`, wait on a call, and write `results` back can still overwrite each other's answers. So each provider returns only its own slot, and the orchestrator merges the three slots once, keyed by provider name, after all of them settle.

## async on one thread, not threads

The parallel step is a `Promise.all` over one async call per provider. Provider calls spend their time waiting on the network, so the event loop overlaps them without a thread pool, shared memory or locks that could deadlock. This would change for a CPU-bound agent, such as a model running in-process, because it would block the event loop and with it its own deadline. That agent would move to a worker thread behind the same interface.

## what the trace shows

Every run prints one log line per agent with its status, duration, attempt and what it added to the context. A timeline follows, in which parallel agents share a step number and start in the same column, and a footer compares total time with summed agent time. `--trace-json` also prints every context version. `examples/partial-failure.txt` shows C running to its deadline while A and B finish.

## how it is tested

I designed the test cases before writing the code. Each test name starts with its case ID, such as `TC-5.4`, so a failure points to the requirement it covers.

| Layer | Tests | What runs |
|---|---|---|
| unit | 38 | one agent, or the timeline printer |
| orch | 26 | the orchestrator with stub agents and real timers |
| chain | 17 | real agents and mock providers: the four statement test cases |
| cli | 7 | `node src/main.ts` as a child process |

## assumptions and known limits

- When the text names no origin, it defaults to NYC, as in the statement's example. Test case 4 is then missing only destination and type.
- "Next month" counts as a valid date. "Next Friday" means the first Friday after today.
- A destination is the capitalised words after "to" or "in", so "St. Louis" parses as "St".
- All provider data is mocked in `src/scenarios.ts`.

Time spent: about 1.5 hours.
