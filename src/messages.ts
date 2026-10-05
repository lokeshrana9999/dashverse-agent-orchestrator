// Every string a user reads: replies, notes, the clarification question, stop
// errors and CLI usage. Agents decide what to say; this file decides the words.

import { describeDate } from "./dates.ts";
import type { Offer, SlotFailure, TravelRequest, TravelType } from "./types.ts";

// ------------------------------------------------------------- validator --

export const PAST_DATE = "date is in the past";

const ASK_FOR: Record<string, string> = {
  destination: "where to",
  date: "when",
  type: "flight or hotel",
};

/** `["destination", "type"]` to `"Where to, and flight or hotel?"`. */
export function clarificationQuestion(missing: readonly string[]): string {
  const asks = missing.map((field) => ASK_FOR[field] ?? field);
  const text = asks.length === 1 ? asks[0] : `${asks.slice(0, -1).join(", ")}, and ${asks.at(-1)}`;
  return `${text[0].toUpperCase()}${text.slice(1)}?`;
}

// ------------------------------------------------------------- providers --

/** The chain's stop error when no provider answered. */
export function noProviderReached(type: TravelType, failures: Record<string, SlotFailure>): string {
  const list = Object.entries(failures)
    .map(([provider, failure]) => `${provider}: ${failure.failed}`)
    .join(", ");
  return `Couldn't reach any ${type} provider (${list}). Please try again.`;
}

export const timeoutDetail = (timeoutMs: number) => `no answer within ${timeoutMs} ms`;

// ------------------------------------------------------------- formatter --

export const BEST_MARK = "<- best";

function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatStops(stops: number): string {
  if (stops === 0) return "direct";
  return stops === 1 ? "1 stop" : `${stops} stops`;
}

function formatPrice(price: number, type: TravelType): string {
  return type === "hotel" ? `$${price}/night` : `$${price}`;
}

/** `"Air France $450 (7h 30m, direct)"` or `"Hilton $240/night"`. */
function describeOffer(offer: Offer, type: TravelType): string {
  const price = `${offer.name} ${formatPrice(offer.price, type)}`;
  if (type === "hotel" || offer.durationMin === undefined) return price;
  return `${price} (${formatDuration(offer.durationMin)}, ${formatStops(offer.stops ?? 0)})`;
}

/** `"I found 3 flights to Tokyo on Dec 1. Best: Air France $450 (7h 30m, direct)"`. */
export function summaryLine(request: TravelRequest, count: number, best: Offer): string {
  const noun = count === 1 ? request.type : `${request.type}s`;
  const preposition = request.type === "hotel" ? "in" : "to";
  return (
    `I found ${count} ${noun} ${preposition} ${request.destination} ${describeDate(request.date)}. ` +
    `Best: ${describeOffer(best, request.type)}`
  );
}

/** One aligned row per offer, best first, each marked best or with its gap to the best. */
export function comparisonRows(ranked: readonly Offer[], type: TravelType): string[] {
  const best = ranked[0];
  const cells = ranked.map((offer) => {
    const details =
      type === "flight" && offer.durationMin !== undefined
        ? [formatDuration(offer.durationMin), formatStops(offer.stops ?? 0)]
        : [];
    const mark = offer === best ? BEST_MARK : `+$${offer.price - best.price}`;
    return [offer.provider, offer.name, formatPrice(offer.price, type), ...details, mark];
  });
  const widths = cells[0].map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  return cells.map((row) =>
    `  ${row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join("  ")}`,
  );
}

/** `"Note: Provider C didn't respond (timeout)"`, or the plural form for several. */
export function missingProvidersNote(failures: Record<string, SlotFailure>): string {
  const entries = Object.entries(failures);
  if (entries.length === 1) {
    const [[provider, failure]] = entries;
    return `Note: Provider ${provider} didn't respond (${failure.failed})`;
  }
  const parts = entries.map(([provider, failure]) => `${provider} (${failure.failed})`);
  const list = `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Note: Providers ${list} didn't respond`;
}

// ------------------------------------------------------------------- CLI --

export const USAGE =
  'usage: node src/main.ts "<request text>" [--scenario <name>] [--today YYYY-MM-DD] [--trace-json]';

export const invalidToday = (value: string) => `invalid --today "${value}": expected a real date as YYYY-MM-DD`;

export const unknownScenario = (name: string, known: readonly string[]) =>
  `unknown scenario "${name}"; choose one of: ${known.join(", ")}`;
