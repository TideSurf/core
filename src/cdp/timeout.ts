import { CDPTimeoutError, ValidationError } from "../errors.js";
import { MAX_TIMER_DELAY_MS } from "../validation.js";

/**
 * Race a promise against a timeout. Throws CDPTimeoutError if the timeout fires first.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMER_DELAY_MS) {
    void promise.catch(() => undefined);
    return Promise.reject(
      new ValidationError(
        `timeout must be between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`
      )
    );
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new CDPTimeoutError(operation, ms));
      }
    }, ms);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    );
  });
}
