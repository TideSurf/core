import { ValidationError } from "./errors.js";

const URL_PATTERN = /^https?:\/\/.+/;
const ELEMENT_ID_PATTERN = /^[A-Z]\d+$/;

/**
 * Validate a URL string
 */
export function validateUrl(url: string): void {
  if (!url || typeof url !== "string") {
    throw new ValidationError("URL must be a non-empty string");
  }
  if (!URL_PATTERN.test(url)) {
    throw new ValidationError(
      `Invalid URL: "${url}". Must start with http:// or https://`
    );
  }
}

/**
 * Validate a CSS selector string
 */
export function validateSelector(selector: string): void {
  if (!selector || typeof selector !== "string") {
    throw new ValidationError("Selector must be a non-empty string");
  }
  if (selector.length > 1000) {
    throw new ValidationError("Selector is too long (max 1000 characters)");
  }
}

/**
 * Validate a JavaScript expression
 */
export function validateExpression(expression: string): void {
  if (!expression || typeof expression !== "string") {
    throw new ValidationError("Expression must be a non-empty string");
  }
  if (expression.length > 10000) {
    throw new ValidationError(
      "Expression is too long (max 10000 characters)"
    );
  }
}

/**
 * Validate a TCP port number
 */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `Invalid port: ${port}. Must be an integer between 1 and 65535`
    );
  }
}

/**
 * Validate an element ID (e.g. "B1", "L3")
 */
export function validateElementId(id: string): void {
  if (!id || typeof id !== "string") {
    throw new ValidationError("Element ID must be a non-empty string");
  }
  if (!ELEMENT_ID_PATTERN.test(id)) {
    throw new ValidationError(
      `Invalid element ID: "${id}". Expected format like B1, L3, I2, S1`
    );
  }
}

/**
 * Validate a file path string
 */
export function validateFilePath(filePath: string): void {
  if (!filePath || typeof filePath !== "string") {
    throw new ValidationError("File path must be a non-empty string");
  }
}
