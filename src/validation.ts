import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ValidationError } from "./errors.js";

const ELEMENT_ID_PATTERN = /^[A-Z]\d+$/;
const DEFAULT_FILE_ACCESS_ROOTS = [process.cwd(), tmpdir()];

/**
 * Validate a URL string
 */
export function validateUrl(url: string): void {
  if (!url || typeof url !== "string") {
    throw new ValidationError("URL must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: "${url}". Must be a valid absolute URL`);
  }

  const allowedProtocols = new Set(["http:", "https:", "data:", "about:"]);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new ValidationError(
      `Invalid URL: "${url}". Must start with http://, https://, data:, or about:`
    );
  }

  if (/\s/.test(url)) {
    throw new ValidationError(`Invalid URL: "${url}". Whitespace is not allowed`);
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
  if (filePath.includes("\0")) {
    throw new ValidationError("File path must not contain null bytes");
  }
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function findNearestExistingAncestor(pathValue: string): string {
  let current = resolve(pathValue);

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new ValidationError(
        `Path "${pathValue}" does not have an existing parent directory`
      );
    }
    current = parent;
  }

  return current;
}

export function resolveFileAccessRoots(roots?: string[]): string[] {
  const candidates =
    roots && roots.length > 0 ? roots : DEFAULT_FILE_ACCESS_ROOTS;

  const normalized = candidates.map((root) => {
    validateFilePath(root);

    const absolute = resolve(root);
    if (!existsSync(absolute)) {
      throw new ValidationError(`File access root does not exist: "${root}"`);
    }

    const stats = statSync(absolute);
    if (!stats.isDirectory()) {
      throw new ValidationError(
        `File access root must be a directory: "${root}"`
      );
    }

    return realpathSync.native(absolute);
  });

  return [...new Set(normalized)];
}

function ensureAllowedPath(
  pathValue: string,
  roots: string[],
  resolvedPath: string,
  label: string
): void {
  if (!roots.some((root) => isWithinRoot(resolvedPath, root))) {
    throw new ValidationError(
      `${label} "${pathValue}" is outside allowed file access roots`
    );
  }
}

export function validateUploadFilePath(
  filePath: string,
  roots?: string[]
): string {
  validateFilePath(filePath);

  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new ValidationError(`File does not exist: "${filePath}"`);
  }

  const resolved = realpathSync.native(absolute);
  const stats = statSync(resolved);
  if (!stats.isFile()) {
    throw new ValidationError(`Upload path must be a file: "${filePath}"`);
  }

  ensureAllowedPath(filePath, resolveFileAccessRoots(roots), resolved, "File");
  return resolved;
}

export function validateDownloadDirectory(
  downloadDir: string,
  roots?: string[]
): string {
  validateFilePath(downloadDir);

  const absolute = resolve(downloadDir);
  const allowedRoots = resolveFileAccessRoots(roots);
  const existingAncestor = findNearestExistingAncestor(absolute);
  const ancestorRealPath = realpathSync.native(existingAncestor);

  ensureAllowedPath(
    downloadDir,
    allowedRoots,
    ancestorRealPath,
    "Download directory"
  );

  if (existsSync(absolute)) {
    const resolved = realpathSync.native(absolute);
    ensureAllowedPath(downloadDir, allowedRoots, resolved, "Download directory");

    const stats = statSync(resolved);
    if (!stats.isDirectory()) {
      throw new ValidationError(
        `Download path must be a directory: "${downloadDir}"`
      );
    }
  }

  return absolute;
}

/**
 * Validate that a numeric option is a positive integer.
 */
export function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
}

/**
 * Validate that a numeric option is a positive finite number.
 */
export function validatePositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive number`);
  }
}

/**
 * Validate a freeform text query.
 */
export function validateSearchQuery(query: string): void {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new ValidationError("Search query must be a non-empty string");
  }
  if (query.length > 1000) {
    throw new ValidationError("Search query is too long (max 1000 characters)");
  }
}
