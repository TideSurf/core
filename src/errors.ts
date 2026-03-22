/**
 * Base error class for all TideSurf errors
 */
export class TideSurfError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TideSurfError";
  }
}

/**
 * Failed to connect to Chrome via CDP
 */
export class CDPConnectionError extends TideSurfError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPConnectionError";
  }
}

/**
 * CDP operation timed out
 */
export class CDPTimeoutError extends TideSurfError {
  constructor(operation: string, timeoutMs: number, options?: ErrorOptions) {
    super(`${operation} timed out after ${timeoutMs}ms`, options);
    this.name = "CDPTimeoutError";
  }
}

/**
 * Failed to launch Chrome process
 */
export class ChromeLaunchError extends TideSurfError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChromeLaunchError";
  }
}

/**
 * Element not found in the current node map
 */
export class ElementNotFoundError extends TideSurfError {
  constructor(id: string) {
    super(
      `Element "${id}" not found. Call getState() first to refresh the node map.`
    );
    this.name = "ElementNotFoundError";
  }
}

/**
 * Navigation failed
 */
export class NavigationError extends TideSurfError {
  constructor(url: string, reason?: string, options?: ErrorOptions) {
    super(`Navigation to "${url}" failed${reason ? `: ${reason}` : ""}`, options);
    this.name = "NavigationError";
  }
}

/**
 * Input validation failed
 */
export class ValidationError extends TideSurfError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Operation blocked by read-only mode
 */
export class ReadOnlyError extends TideSurfError {
  constructor(operation: string) {
    super(
      `"${operation}" is not allowed in read-only mode. ` +
      `Launch or connect without readOnly to enable mutating operations.`
    );
    this.name = "ReadOnlyError";
  }
}
