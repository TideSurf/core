import { CDPTimeoutError } from "../errors.js";

/**
 * Race a promise against a timeout. Throws CDPTimeoutError if the timeout fires first.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CDPTimeoutError(operation, ms));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
