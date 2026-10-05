// Reads free text into fields. It records only what the text says and never
// judges it: missing fields are the validator's call. This is the agent that
// could become an LLM call later without touching the rest of the chain.

import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  isIsoDay,
  nextMonth,
  nextOccurrence,
  nextWeekday,
} from "../dates.ts";
import type { Agent, AgentResult, Parsed, TravelContext, TravelType } from "../types.ts";

export class ParserAgent implements Agent<TravelContext> {
  readonly name = "parser";
  readonly #today: string;

  constructor({ today }: { today: string }) {
    this.#today = today;
  }

  async run(context: TravelContext): Promise<AgentResult<TravelContext>> {
    return { status: "ok", context: { ...context, parsed: parseRequest(context.text, this.#today) } };
  }
}

export function parseRequest(text: string, today: string): Parsed {
  const parsed: Parsed = {};
  const type = parseType(text);
  const destination = parsePlace(text, /\b(?:[Tt]o|[Ii]n)\s+/g);
  const date = parseDate(text, today);
  const origin = parsePlace(text, /\b[Ff]rom\s+/g);
  if (type) parsed.type = type;
  if (destination) parsed.destination = destination;
  if (date) parsed.date = date;
  if (origin) parsed.origin = origin;
  return parsed;
}

// ------------------------------------------------------------------ type --

const TYPE_WORDS: Array<[RegExp, TravelType]> = [
  [/\b(?:fly|flying|flights?)\b/i, "flight"],
  [/\b(?:hotels?|stay)\b/i, "hotel"],
];

/** The travel type whose keyword appears first in the text. */
function parseType(text: string): TravelType | undefined {
  let found: { type: TravelType; at: number } | undefined;
  for (const [pattern, type] of TYPE_WORDS) {
    const at = text.search(pattern);
    if (at >= 0 && (!found || at < found.at)) found = { type, at };
  }
  return found?.type;
}

// ----------------------------------------------------------------- place --

/** Capitalised words that end a place name rather than belong to it. */
const NOT_PLACE = new Set([
  ...MONTH_NAMES.flatMap((month) => [month.toLowerCase(), month.slice(0, 3).toLowerCase()]),
  "sept",
  ...WEEKDAY_NAMES,
  "next",
  "tomorrow",
  "on",
  "for",
  "from",
  "in",
  "to",
]);

/**
 * The capitalised words after a lead-in ("to", "in", "from"), stopping at the
 * first lowercase word, date word or punctuation: "to New York on Dec 1" is
 * `New York`. A lowercase place ("to tokyo") is not recognised.
 */
function parsePlace(text: string, leadIn: RegExp): string | undefined {
  for (const match of text.matchAll(leadIn)) {
    const words: string[] = [];
    for (const word of text.slice(match.index + match[0].length).split(/\s+/)) {
      const clean = word.replace(/[.,!?;:]+$/, "");
      if (!/^\p{Lu}[\p{L}'-]*$/u.test(clean) || NOT_PLACE.has(clean.toLowerCase())) break;
      words.push(clean);
      if (clean !== word) break; // punctuation ends the name
    }
    if (words.length > 0) return words.join(" ");
  }
  return undefined;
}

// ------------------------------------------------------------------ date --

const MONTH_PATTERN = MONTH_NAMES.map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join("|");
const MONTH_DAY = new RegExp(`\\b(${MONTH_PATTERN}|sept)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
const NEXT_WEEKDAY = new RegExp(`\\bnext\\s+(${WEEKDAY_NAMES.join("|")})\\b`, "i");

function monthNumber(word: string): number {
  const prefix = word.slice(0, 3).toLowerCase();
  return MONTH_NAMES.findIndex((month) => month.toLowerCase().startsWith(prefix)) + 1;
}

/**
 * Resolves the supported date phrases against `today`:
 * ISO dates as written, "December 1st" / "Dec 1" (next one not yet passed),
 * "tomorrow", "next Friday" (first Friday after today), "next month" (`YYYY-MM`).
 */
function parseDate(text: string, today: string): string | undefined {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso && isIsoDay(iso[1])) return iso[1];

  const monthDay = MONTH_DAY.exec(text);
  if (monthDay) return nextOccurrence(today, monthNumber(monthDay[1]), Number(monthDay[2]));

  if (/\btomorrow\b/i.test(text)) return addDays(today, 1);

  const weekday = NEXT_WEEKDAY.exec(text);
  if (weekday) return nextWeekday(today, (WEEKDAY_NAMES as readonly string[]).indexOf(weekday[1].toLowerCase()));

  if (/\bnext\s+month\b/i.test(text)) return nextMonth(today);

  return undefined;
}
