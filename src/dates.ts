// Calendar arithmetic on ISO strings, in UTC so the host time zone never
// shifts a day. Dates are `YYYY-MM-DD`; a whole month is `YYYY-MM`.

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const WEEKDAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds for a calendar date, or undefined when it doesn't exist (Feb 30). */
function utc(year: number, month: number, day: number): number | undefined {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  const exists =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return exists ? time : undefined;
}

function toIsoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `"2026-10-05"` to its parts, or undefined if it isn't a real `YYYY-MM-DD` date. */
export function parseIsoDay(text: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return utc(year, month, day) === undefined ? undefined : { year, month, day };
}

export function isIsoDay(text: string): boolean {
  return parseIsoDay(text) !== undefined;
}

function timeOf(isoDay: string): number {
  const parts = parseIsoDay(isoDay);
  if (!parts) throw new RangeError(`not a YYYY-MM-DD date: ${isoDay}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function addDays(isoDay: string, days: number): string {
  return toIsoDay(timeOf(isoDay) + days * DAY_MS);
}

/** The first `weekday` (0 = Sunday) strictly after `today`: a week ahead when today is that day. */
export function nextWeekday(today: string, weekday: number): string {
  const current = new Date(timeOf(today)).getUTCDay();
  const ahead = (weekday - current + 7) % 7 || 7;
  return addDays(today, ahead);
}

/** The month after `today`, as `YYYY-MM`. */
export function nextMonth(today: string): string {
  const { year, month } = parseIsoDay(today)!;
  return month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
}

/**
 * The next `month`/`day` that has not passed: today counts as not passed, so
 * "October 5th" said on 2026-10-05 is 2026-10-05. Undefined for impossible days.
 */
export function nextOccurrence(today: string, month: number, day: number): string | undefined {
  const { year } = parseIsoDay(today)!;
  const thisYear = utc(year, month, day);
  if (thisYear !== undefined && thisYear >= timeOf(today)) return toIsoDay(thisYear);
  const nextYear = utc(year + 1, month, day);
  return nextYear === undefined ? undefined : toIsoDay(nextYear);
}

/** True when a day, or a whole month, lies before `today`. */
export function isPast(date: string, today: string): boolean {
  return date.length === 7 ? date < today.slice(0, 7) : date < today;
}

/** `"2026-12-01"` to `"on Dec 1"`; `"2026-11"` to `"in November 2026"`. */
export function describeDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const name = MONTH_NAMES[month - 1];
  return day === undefined ? `in ${name} ${year}` : `on ${name.slice(0, 3)} ${day}`;
}
