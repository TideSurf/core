import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ValidationError } from "./errors.js";

const ELEMENT_ID_PATTERN = /^[A-Z]\d+$/;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "about:"]);
const NON_LATIN_HOST_SCRIPTS =
  /\p{Script=Han}|\p{Script=Cyrl}|\p{Script=Greek}|\p{Script=Arabic}/u;

export interface UrlValidationOptions {
  /** Allow localhost and loopback addresses such as 127.0.0.1 and ::1. */
  allowLocalhost?: boolean;
  /** Allow private/link-local network addresses. Also allows localhost. */
  allowPrivateHosts?: boolean;
}

// Chrome accepts dotted and hexadecimal IPv4-mapped IPv6 addresses.
function unmapIPv4FromIPv6(host: string): string | null {
  const lower = host.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

// Cover loopback, unspecified, ULA, and link-local IPv6 ranges.
function isLocalhostIPv6(host: string): boolean {
  return host.toLowerCase() === "::1";
}

function isPrivateIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::") return true;
  // all-zero v6 (::, 0:0:0:0:0:0:0:0, etc.)
  if (/^0*(?::0*)+$/.test(lower)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(lower)) return true; // fc00::/8
  if (/^fd[0-9a-f]{2}:/i.test(lower)) return true; // fd00::/8 (ULA other half)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true; // fe80::/10
  return false;
}

/**
 * Validate a URL string
 */
export function validateUrl(url: string, options: UrlValidationOptions = {}): void {
  if (!url || typeof url !== "string") {
    throw new ValidationError("URL must be a non-empty string");
  }

  // Bound inputs before URL parsing.
  if (url.length > 2048) {
    throw new ValidationError("URL exceeds maximum length of 2048 characters");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: "${url}". Must be a valid absolute URL`);
  }

  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new ValidationError(
      `Invalid URL: "${url}". Must start with http://, https://, or about:`
    );
  }

  if (/\s/.test(url)) {
    throw new ValidationError(`Invalid URL: "${url}". Whitespace is not allowed`);
  }

  // Apply the literal-host network policy.
  let hostname = parsed.hostname;
  if (hostname) {
    // IPv6 addresses in URLs may have brackets; normalize for checks
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    hostname = hostname.toLowerCase().replace(/\.$/, "");
    // Unmap IPv4-mapped IPv6 before applying IPv4 range checks.
    const ipv4 = unmapIPv4FromIPv6(hostname) ?? hostname;
    const isLocalhost =
      ipv4 === "localhost" ||
      ipv4.endsWith(".localhost") ||
      /^127\./.test(ipv4) ||
      isLocalhostIPv6(hostname);
    const isPrivateHost =
      /^10\./.test(ipv4) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4) ||
      /^192\.168\./.test(ipv4) ||
      /^169\.254\./.test(ipv4) || // Link-local
      /^0\./.test(ipv4) ||
      isPrivateIPv6(hostname);

    if (
      (isLocalhost && !options.allowLocalhost && !options.allowPrivateHosts) ||
      (isPrivateHost && !options.allowPrivateHosts)
    ) {
      throw new ValidationError(
        `Invalid URL: "${url}". Private IP addresses and localhost are not allowed`
      );
    }
  }

  // Reject punycode and mixed-script hostnames.
  if (hostname && hostname.includes("xn--")) {
    throw new ValidationError(
      `Invalid URL: "${url}". Punycode hostnames are not allowed (possible homograph attack)`
    );
  }
  if (hostname && /\p{Script=Latin}/u.test(hostname)) {
    if (NON_LATIN_HOST_SCRIPTS.test(hostname)) {
      throw new ValidationError(
        `Invalid URL: "${url}". Mixed-script hostnames are not allowed (possible homograph attack)`
      );
    }
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
 * Validate the shape and size of arbitrary page JavaScript.
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
  const candidates = roots ?? [process.cwd(), tmpdir()];

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

export function resolveImplicitDownloadRoot(roots?: string[]): string {
  const allowedRoots = resolveFileAccessRoots(roots);
  if (allowedRoots.length === 0) {
    throw new ValidationError(
      "Downloads are disabled because no file access roots are configured"
    );
  }

  const systemTemp = realpathSync.native(tmpdir());
  return allowedRoots.some((root) => isWithinRoot(systemTemp, root))
    ? systemTemp
    : allowedRoots[0];
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
  const allowedRoots = resolveFileAccessRoots(roots);
  if (allowedRoots.length === 0) {
    throw new ValidationError(
      "Uploads are disabled because no file access roots are configured"
    );
  }

  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new ValidationError(`File does not exist: "${filePath}"`);
  }

  const resolved = realpathSync.native(absolute);
  const stats = statSync(resolved);
  if (!stats.isFile()) {
    throw new ValidationError(`Upload path must be a file: "${filePath}"`);
  }

  ensureAllowedPath(filePath, allowedRoots, resolved, "File");
  return resolved;
}

export function validateDownloadDirectory(
  downloadDir: string,
  roots?: string[]
): string {
  validateFilePath(downloadDir);

  const absolute = resolve(downloadDir);
  const allowedRoots = resolveFileAccessRoots(roots);
  if (allowedRoots.length === 0) {
    throw new ValidationError(
      "Downloads are disabled because no file access roots are configured"
    );
  }
  const existingAncestor = findNearestExistingAncestor(absolute);
  const ancestorRealPath = realpathSync.native(existingAncestor);

  ensureAllowedPath(
    downloadDir,
    allowedRoots,
    ancestorRealPath,
    "Download directory"
  );

  if (existingAncestor === absolute) {
    const stats = statSync(ancestorRealPath);
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
