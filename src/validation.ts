import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ValidationError } from "./errors.js";

const ELEMENT_ID_PATTERN = /^[A-Z]\d+$/;
const DEFAULT_FILE_ACCESS_ROOTS = [process.cwd(), tmpdir()];

// 0.5.2: IPv4-mapped IPv6 unmap. Covers both dotted (::ffff:1.2.3.4) and
// hex (::ffff:0102:0304) tails since Chrome accepts both in URLs.
function unmapIPv4FromIPv6(host: string): string | null {
  const lower = host.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }
  }
  return null;
}

// 0.5.2: reject reserved IPv6 ranges including the unspecified address (::)
// which was previously missed. Covers loopback, unspecified, ULA (fc00::/7),
// and link-local (fe80::/10).
function isBlockedIPv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
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
export function validateUrl(url: string): void {
  if (!url || typeof url !== "string") {
    throw new ValidationError("URL must be a non-empty string");
  }

  // NEW-CRIT-004: URL length limit to prevent buffer overflow and DoS
  if (url.length > 2048) {
    throw new ValidationError("URL exceeds maximum length of 2048 characters");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: "${url}". Must be a valid absolute URL`);
  }

  // HIGH-019: data: URLs are blocked to prevent XSS and data exfiltration
  const allowedProtocols = new Set(["http:", "https:", "about:"]);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new ValidationError(
      `Invalid URL: "${url}". Must start with http://, https://, or about:`
    );
  }

  if (/\s/.test(url)) {
    throw new ValidationError(`Invalid URL: "${url}". Whitespace is not allowed`);
  }

  // Check for private IP addresses ( SSRF prevention )
  let hostname = parsed.hostname;
  if (hostname) {
    // IPv6 addresses in URLs may have brackets; normalize for checks
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    // 0.5.2: IPv4-mapped IPv6 (::ffff:169.254.169.254) used to bypass the
    // IPv4 checks below — unmap it so the v4-range regexes see the real v4.
    const ipv4 = unmapIPv4FromIPv6(hostname) ?? hostname;
    if (
      ipv4 === "localhost" ||
      /^127\./.test(ipv4) ||
      /^10\./.test(ipv4) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4) ||
      /^192\.168\./.test(ipv4) ||
      /^169\.254\./.test(ipv4) || // Link-local
      /^0\./.test(ipv4) ||
      isBlockedIPv6(hostname)
    ) {
      throw new ValidationError(
        `Invalid URL: "${url}". Private IP addresses and localhost are not allowed`
      );
    }
  }

  // Check for IDN homograph attacks ( mixed script / punycode )
  // First check if hostname contains punycode (xn--)
  if (hostname && hostname.includes("xn--")) {
    throw new ValidationError(
      `Invalid URL: "${url}". Punycode hostnames are not allowed (possible homograph attack)`
    );
  }
  // Check for mixed scripts in the hostname
  if (hostname && /\p{Script=Latin}/u.test(hostname)) {
    // If hostname has Latin chars, check for other scripts
    const nonLatinScripts = /\p{Script=Han}|\p{Script=Cyrl}|\p{Script=Greek}|\p{Script=Arabic}/u;
    if (nonLatinScripts.test(hostname)) {
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
 * Blocked patterns for dangerous JavaScript APIs
 * CRIT-002: Prevent access to cookies, storage, network, and code execution
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdocument\s*\.\s*cookie\b/i, label: "document.cookie" },
  {
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    label: "storage API",
  },
  { pattern: /\bfetch\s*\(/i, label: "fetch()" },
  { pattern: /\b(?:XMLHttpRequest|WebSocket)\b/i, label: "network constructor" },
  // 0.5.2: \beval\b (word boundary) catches (0,eval)(...) and window.eval
  { pattern: /\beval\b/i, label: "eval" },
  // Function constructor (case-sensitive — `function` keyword is fine)
  { pattern: /\bFunction\s*\(/, label: "Function constructor" },
  // 0.5.2: .constructor chain blocks "".constructor.constructor(...) bypass
  { pattern: /\.\s*constructor\b/i, label: ".constructor" },
  // 0.5.2: dynamic import
  { pattern: /\bimport\s*\(/i, label: "import()" },
];

// 0.5.2: decode common escape sequences so attackers can't hide identifiers
// behind \uXXXX / \xXX / \u{XXXX}. Done BEFORE scanning so e.g. "\u0063ookie"
// normalizes to "cookie".
function decodeEscapes(expression: string): string {
  return expression
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

// 0.5.2: collapse static-string bracket indexing to dot access so
// document["cookie"] and window[`eval`] normalize into the dot-notation the
// denylist already covers.
function normalizeBracketAccess(expression: string): string {
  return expression.replace(
    /\[\s*(["'`])([A-Za-z_$][\w$]*)\1\s*\]/g,
    ".$2"
  );
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

  // CRIT-002 / 0.5.2: normalize bracket indexing + decoded escapes, then
  // denylist-scan. Scanning BOTH the original and normalized forms ensures a
  // pattern can't be hidden by partial normalization.
  const decoded = decodeEscapes(expression);
  const normalized = normalizeBracketAccess(decoded);
  for (const { pattern, label } of BLOCKED_PATTERNS) {
    if (pattern.test(expression) || pattern.test(normalized)) {
      throw new ValidationError(
        `Expression contains disallowed pattern: ${label}`
      );
    }
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

  // SEC-005: TOCTOU protection - re-resolve at point of use
  const finalResolved = realpathSync.native(absolute);
  const allowedRoots = resolveFileAccessRoots(roots);
  ensureAllowedPath(filePath, allowedRoots, finalResolved, "File");
  return finalResolved;
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
