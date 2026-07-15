import { CDPTimeoutError, ValidationError } from "../errors.js";

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

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ValidationError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) {
    throw new ValidationError("initialDelayMs must be a non-negative finite number");
  }
  if (!Number.isFinite(backoffFactor) || backoffFactor <= 0) {
    throw new ValidationError("backoffFactor must be a positive finite number");
  }

  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !retryable(err)) {
        throw err;
      }

      const delay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
}
