import { CDPTimeoutError, ValidationError } from "../errors.js";
import { MAX_TIMER_DELAY_MS } from "../validation.js";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  retryable?: (err: unknown) => boolean;
}

const DEFAULT_RETRYABLE = (err: unknown): boolean =>
  !(err instanceof CDPTimeoutError);

/**
 * Retry a function with exponential backoff.
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    backoffFactor = 2,
    retryable = DEFAULT_RETRYABLE,
  } = options;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new ValidationError("maxAttempts must be a positive safe integer");
  }
  if (
    !Number.isFinite(initialDelayMs) ||
    initialDelayMs < 0 ||
    initialDelayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new ValidationError(
      `initialDelayMs must be between 0 and ${MAX_TIMER_DELAY_MS}`
    );
  }
  if (!Number.isFinite(backoffFactor) || backoffFactor <= 0) {
    throw new ValidationError("backoffFactor must be a positive finite number");
  }
  const largestDelay = initialDelayMs === 0 || maxAttempts < 2
    ? 0
    : initialDelayMs * Math.max(1, backoffFactor ** (maxAttempts - 2));
  if (!Number.isFinite(largestDelay) || largestDelay > MAX_TIMER_DELAY_MS) {
    throw new ValidationError(
      `retry delay must not exceed ${MAX_TIMER_DELAY_MS} milliseconds`
    );
  }

  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !retryable(err)) {
        throw err;
      }

      const delay = initialDelayMs * backoffFactor ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
}
