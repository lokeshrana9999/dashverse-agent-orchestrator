// Tunable defaults for the travel chain, in one place.

/** Filled in by the validator when the text names no origin. */
export const DEFAULT_ORIGIN = "NYC";

/** About 3x the slowest mock provider (320 ms), so a dead provider costs ~1 s. */
export const PROVIDER_TIMEOUT_MS = 1000;

/** One more attempt after an error, inside the same deadline. */
export const PROVIDER_RETRIES = 1;

/** Best-effort: one answering provider is enough to reply. */
export const MIN_PROVIDER_SUCCESSES = 1;
