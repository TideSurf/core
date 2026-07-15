export class TideSurfError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TideSurfError";
  }
}

export class CDPConnectionError extends TideSurfError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CDPConnectionError";
  }
}

export class CDPTimeoutError extends TideSurfError {
  constructor(operation: string, timeoutMs: number, options?: ErrorOptions) {
    super(`${operation} timed out after ${timeoutMs}ms`, options);
    this.name = "CDPTimeoutError";
  }
}

export class ChromeLaunchError extends TideSurfError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChromeLaunchError";
  }
}

export class ElementNotFoundError extends TideSurfError {
  constructor(id: string, additionalInfo?: string) {
    const baseMessage = `Element "${id}" not found. Read the page again to refresh its action IDs.`;
    super(additionalInfo ? `${baseMessage} ${additionalInfo}` : baseMessage);
    this.name = "ElementNotFoundError";
  }
}

export class NavigationError extends TideSurfError {
  constructor(url: string, reason?: string, options?: ErrorOptions) {
    super(`Navigation to "${url}" failed${reason ? `: ${reason}` : ""}`, options);
    this.name = "NavigationError";
  }
}

export class ValidationError extends TideSurfError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ReadOnlyError extends TideSurfError {
  constructor(operation: string) {
    super(
      `"${operation}" is not allowed in read-only mode. ` +
      `Launch or connect without readOnly to enable mutating operations.`
    );
    this.name = "ReadOnlyError";
  }
}

export class ActionCommittedError extends TideSurfError {
  constructor(
    operation: string,
    cause: unknown,
    certainty: "committed" | "uncertain" = "committed"
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const status = certainty === "uncertain" ? "may have completed" : "completed";
    super(
      `${operation} ${status}, but follow-up verification or cleanup failed: ${detail}. ` +
      "Inspect current state before the next action.",
      { cause: cause instanceof Error ? cause : undefined }
    );
    this.name = "ActionCommittedError";
  }
}
