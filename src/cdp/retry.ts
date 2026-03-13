import { CDPTimeoutError } from "../errors.js";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  retryable?: (err: unknown) => boolean;
}

const DEFAULT_RETRYABLE = (err: unknown): boolean => {
  // Timeout errors should NOT be retried (they indicate a fundamental problem)
  if (err instanceof CDPTimeoutError) return false;
  return true;
};

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

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !retryable(err)) {
        throw err;
      }

      const delay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError;
}
