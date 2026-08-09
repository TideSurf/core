import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadSkillDirectory } from "./skills.js";
import type { SkillInfo } from "./skills.js";

const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-.]*[a-z0-9])?$/;
const CANONICAL_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const CANONICAL_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_MCP_SERVERS = 128;
const COMMAND_TOKEN_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const COMMAND_FORBIDDEN_PATTERN = /[\s;&|<>()$`{}\[\]!#]/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const KNOWN_MANIFEST_FIELDS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const KNOWN_AUTHOR_FIELDS = new Set(["name", "email", "url"]);
const STDIO_SERVER_FIELDS = new Set(["type", "command", "args", "env", "cwd"]);
const HTTP_SERVER_FIELDS = new Set(["type", "url", "headers"]);
const MCP_TOP_LEVEL_FIELDS = new Set(["$schema", "mcpServers"]);
const PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
const PLUGIN_DATA_PLACEHOLDER = "${PLUGIN_DATA}";

export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: { readonly name?: string; readonly email?: string; readonly url?: string };
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface PluginMcpServer {
  readonly name: string;
  readonly type: "stdio" | "streamable-http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface PluginDiagnostic {
  readonly plugin: string;
  readonly directory: string;
  readonly message: string;
}

export interface LoadedPlugin {
  /** Absolute filesystem-resolved plugin root. */
  readonly directory: string;
  readonly source: "project" | "user";
  readonly name: string;
  readonly manifest: PluginManifest;
  readonly skills: readonly SkillInfo[];
  readonly mcpServers: readonly PluginMcpServer[];
  readonly diagnostics: readonly PluginDiagnostic[];
  readonly mcpDisabled?: string;
  /** Precomputed absolute filesystem-resolved data root for this loaded instance. */
  readonly dataDirectory?: string;
}

interface PluginManifestDraft {
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, unknown>;
}

interface StdioServerDraft {
  name: string;
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd: string;
}

interface HttpServerDraft {
  name: string;
  type: "streamable-http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

interface McpContext {
  readonly pluginName: string;
  readonly directory: string;
  readonly pluginRoot: string;
  readonly pluginData: string;
  readonly diagnostics: PluginDiagnostic[];
}

type ExpectedPathKind = "file" | "directory";
type ContainedPathResult =
  | { readonly state: "ok"; readonly path: string }
  | { readonly state: "missing"; readonly message: string }
  | {
      readonly state: "invalid";
      readonly reason: "outside" | "unreadable" | "wrong-kind";
      readonly message: string;
    };

export function validatePluginName(name: unknown): string | undefined {
  if (typeof name !== "string") return "plugin name must be a string";
  if (name.length === 0 || name.length > 64) return "plugin name must be 1-64 characters";
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return `plugin name "${name}" must start and end with a lowercase alphanumeric character and may only contain lowercase alphanumerics, ".", and "-"`;
  }
  if (name.includes("--") || name.includes("..")) {
    return `plugin name "${name}" must not contain "--" or ".." sequences`;
  }
  return undefined;
}

/**
 * Return the absolute, filesystem-resolved data directory used for a plugin.
 * The two-string signature is retained for callers that have not yet switched
 * to LoadedPlugin.dataDirectory.
 */
export function pluginDataDirectory(home: string, pluginName: string): string {
  const candidate = resolve(home, ".tidesurf", "plugin-data", pluginName);
  return canonicalPotentialPath(candidate) ?? candidate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function isContained(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

// Resolve all existing path segments so a symlink in any ancestor cannot hide
// an escape. Missing descendants are appended to the nearest real ancestor.
// A present-but-unresolvable path (for example a broken symlink) fails closed.
function canonicalPotentialPath(target: string): string | undefined {
  const missing: string[] = [];
  let current = resolve(target);
  for (;;) {
    try {
      lstatSync(current);
    } catch (error) {
      if (!isMissingPathError(error)) return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      missing.unshift(basename(current));
      current = parent;
      continue;
    }

    let canonical: string;
    try {
      canonical = realpathSync(current);
    } catch {
      return undefined;
    }
    return missing.length === 0 ? canonical : join(canonical, ...missing);
  }
}

function resolveContainedExistingPath(
  pluginRoot: string,
  candidate: string,
  label: string,
  expectedKind: ExpectedPathKind
): ContainedPathResult {
  try {
    lstatSync(candidate);
  } catch (error) {
    if (isMissingPathError(error)) return { state: "missing", message: `${label} is missing` };
    return { state: "invalid", reason: "unreadable", message: `${label} is not readable` };
  }

  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    return {
      state: "invalid",
      reason: "unreadable",
      message: `${label} does not resolve to a readable path`,
    };
  }
  if (!isContained(pluginRoot, canonical)) {
    return {
      state: "invalid",
      reason: "outside",
      message: `${label} resolves outside the plugin root`,
    };
  }

  try {
    const stats = statSync(canonical);
    const validKind = expectedKind === "file" ? stats.isFile() : stats.isDirectory();
    if (!validKind) {
      return {
        state: "invalid",
        reason: "wrong-kind",
        message: `${label} must resolve to a ${expectedKind === "file" ? "regular file" : "directory"}`,
      };
    }
  } catch {
    return { state: "invalid", reason: "unreadable", message: `${label} is not readable` };
  }
  return { state: "ok", path: canonical };
}

function readBoundedText(
  path: string,
  label: string
): { readonly text?: string; readonly error?: string } {
  let file: number;
  try {
    file = openSync(path, "r");
  } catch {
    return { error: `${label} is not readable` };
  }

  try {
    const stats = fstatSync(file);
    if (!stats.isFile()) return { error: `${label} is not a regular file` };
    if (stats.size > MAX_CONFIG_BYTES) {
      return { error: `${label} exceeds the ${MAX_CONFIG_BYTES}-byte limit` };
    }

    const bytes = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(file, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_CONFIG_BYTES) {
      return { error: `${label} exceeds the ${MAX_CONFIG_BYTES}-byte limit` };
    }
    return { text: bytes.subarray(0, length).toString("utf8") };
  } catch {
    return { error: `${label} is not readable` };
  } finally {
    try {
      closeSync(file);
    } catch {
      // A close failure cannot make already-read configuration trustworthy or untrustworthy.
    }
  }
}

// Replacement scans only the source string. Placeholder-looking text produced
// by a replacement is therefore not expanded recursively, while unknown text
// remains literal as required by the specification.
function expandPlaceholders(value: string, pluginRoot: string, pluginData: string): string {
  return value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/g, (_token: string, suffix: string) =>
    suffix === "ROOT" ? pluginRoot : pluginData
  );
}

function validateCommand(
  command: unknown,
  ctx: McpContext
): { command: string } | { error: string } {
  if (typeof command !== "string" || command === "") {
    return { error: 'type "stdio" requires a non-empty command string' };
  }
  if (COMMAND_FORBIDDEN_PATTERN.test(command)) {
    return { error: `command "${command}" contains whitespace or shell metacharacters` };
  }
  if (command.startsWith("~")) {
    return { error: `command "${command}" must not use "~"` };
  }
  if (isAbsolute(command) || WINDOWS_ABSOLUTE_PATTERN.test(command)) {
    return { error: `command "${command}" must not be an absolute path` };
  }

  if (command.startsWith("./")) {
    const lexical = resolve(ctx.pluginRoot, command);
    if (!isContained(ctx.pluginRoot, lexical)) {
      return { error: `command "${command}" resolves outside the plugin root` };
    }
    const canonical = canonicalPotentialPath(lexical);
    if (canonical === undefined) {
      return { error: `command "${command}" does not resolve to a safe plugin path` };
    }
    if (!isContained(ctx.pluginRoot, canonical)) {
      return { error: `command "${command}" resolves outside the plugin root` };
    }
    return { command: canonical };
  }

  if (COMMAND_TOKEN_PATTERN.test(command)) return { command };
  return {
    error: `command "${command}" must be a bare executable name or a relative path starting with "./"`,
  };
}

function reportServer(ctx: McpContext, serverName: string, message: string): void {
  ctx.diagnostics.push({
    plugin: ctx.pluginName,
    directory: ctx.directory,
    message: `mcp server "${serverName}": ${message}`,
  });
}

function unknownFields(
  entry: Record<string, unknown>,
  known: ReadonlySet<string>
): string[] {
  return Object.keys(entry).filter((key) => !known.has(key));
}

function isReservedEnvironmentName(name: string): boolean {
  if (process.platform === "win32") {
    const folded = name.toUpperCase();
    return folded === "PLUGIN_ROOT" || folded === "PLUGIN_DATA";
  }
  return name === "PLUGIN_ROOT" || name === "PLUGIN_DATA";
}

function resolveServerCwd(
  value: unknown,
  ctx: McpContext
): { cwd: string } | { error: string } {
  if (typeof value !== "string") return { error: "cwd must be a string" };

  let containmentRoot: string;
  if (value.startsWith("./")) {
    containmentRoot = ctx.pluginRoot;
  } else if (
    value === PLUGIN_ROOT_PLACEHOLDER ||
    value.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}/`)
  ) {
    containmentRoot = ctx.pluginRoot;
  } else if (
    value === PLUGIN_DATA_PLACEHOLDER ||
    value.startsWith(`${PLUGIN_DATA_PLACEHOLDER}/`)
  ) {
    containmentRoot = ctx.pluginData;
  } else {
    return {
      error:
        "cwd must begin with ./, ${PLUGIN_ROOT}, or ${PLUGIN_DATA}; bare and absolute cwd values are invalid",
    };
  }

  const expanded = expandPlaceholders(value, ctx.pluginRoot, ctx.pluginData);
  const lexical = value.startsWith("./")
    ? resolve(ctx.pluginRoot, expanded)
    : resolve(expanded);
  if (!isContained(containmentRoot, lexical)) {
    return { error: `cwd "${value}" resolves outside its declared root` };
  }
  const canonical = canonicalPotentialPath(lexical);
  if (canonical === undefined) {
    return { error: `cwd "${value}" does not resolve to a safe filesystem path` };
  }
  if (!isContained(containmentRoot, canonical)) {
    return { error: `cwd "${value}" resolves outside its declared root` };
  }
  return { cwd: canonical };
}

function loadStdioServer(
  name: string,
  entry: Record<string, unknown>,
  ctx: McpContext
): PluginMcpServer | undefined {
  const fail = (message: string): undefined => {
    reportServer(ctx, name, message);
    return undefined;
  };

  const extra = unknownFields(entry, STDIO_SERVER_FIELDS);
  if (extra.length > 0) {
    return fail(`field(s) ${extra.map((key) => `"${key}"`).join(", ")} are not allowed for type "stdio"`);
  }

  const commandResult = validateCommand(entry.command, ctx);
  if ("error" in commandResult) return fail(commandResult.error);

  let args: string[] | undefined;
  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string")) {
      return fail("args must be an array of strings");
    }
    args = (entry.args as string[]).map((arg) =>
      expandPlaceholders(arg, ctx.pluginRoot, ctx.pluginData)
    );
  }

  let env: Record<string, string> | undefined;
  if (entry.env !== undefined) {
    if (!isPlainObject(entry.env)) return fail("env must be an object mapping strings to strings");
    const values: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(entry.env)) {
      if (isReservedEnvironmentName(key)) {
        return fail(`env must not define reserved key "${key}"`);
      }
      if (typeof value !== "string") return fail(`env.${key} must be a string`);
      values.push([key, expandPlaceholders(value, ctx.pluginRoot, ctx.pluginData)]);
    }
    env = Object.fromEntries(values);
  }

  let cwd = ctx.pluginRoot;
  if (entry.cwd !== undefined) {
    const cwdResult = resolveServerCwd(entry.cwd, ctx);
    if ("error" in cwdResult) return fail(cwdResult.error);
    cwd = cwdResult.cwd;
  }

  const server: StdioServerDraft = {
    name,
    type: "stdio",
    command: commandResult.command,
    cwd,
  };
  if (args !== undefined) server.args = args;
  if (env !== undefined) server.env = env;
  return server;
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost") return true;
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const family = isIP(unbracketed);
  if (family === 4) return unbracketed.split(".")[0] === "127";
  return family === 6 && unbracketed.toLowerCase() === "::1";
}

function loadHttpServer(
  name: string,
  type: "streamable-http" | "sse",
  entry: Record<string, unknown>,
  ctx: McpContext
): HttpServerDraft | undefined {
  const fail = (message: string): undefined => {
    reportServer(ctx, name, message);
    return undefined;
  };

  const extra = unknownFields(entry, HTTP_SERVER_FIELDS);
  if (extra.length > 0) {
    return fail(`field(s) ${extra.map((key) => `"${key}"`).join(", ")} are not allowed for type "${type}"`);
  }
  if (typeof entry.url !== "string" || entry.url === "") {
    return fail(`type "${type}" requires a non-empty url string`);
  }

  const url = entry.url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`url "${url}" is not a valid absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(`url "${url}" must use http or https`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return fail(`url "${url}" must not contain user info`);
  }
  if (parsed.hash !== "") {
    return fail(`url "${url}" must not contain a fragment`);
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    return fail(`url "${url}" must use https (http is only allowed for localhost or loopback IP literals)`);
  }

  let headers: Record<string, string> | undefined;
  if (entry.headers !== undefined) {
    if (!isPlainObject(entry.headers)) {
      return fail("headers must be an object mapping strings to strings");
    }
    const values: Array<[string, string]> = [];
    const names = new Set<string>();
    for (const [key, value] of Object.entries(entry.headers)) {
      if (typeof value !== "string") return fail(`headers.${key} must be a string`);
      try {
        validateHeaderName(key);
      } catch {
        return fail(`header name ${JSON.stringify(key)} is not a valid HTTP field name`);
      }
      const folded = key.toLowerCase();
      if (names.has(folded)) {
        return fail(`header name ${JSON.stringify(key)} duplicates another header case-insensitively`);
      }
      try {
        validateHeaderValue(key, value);
      } catch {
        return fail(`header ${JSON.stringify(key)} has an invalid HTTP field value`);
      }
      names.add(folded);
      values.push([key, value]);
    }
    headers = Object.fromEntries(values);
  }

  const server: HttpServerDraft = { name, type, url };
  if (headers !== undefined) server.headers = headers;
  return server;
}

function loadMcpServers(
  pluginRoot: string,
  pluginName: string,
  pluginData: string,
  diagnostics: PluginDiagnostic[]
): { servers: PluginMcpServer[]; disabled?: string } {
  const servers: PluginMcpServer[] = [];
  const disable = (reason: string): { servers: PluginMcpServer[]; disabled: string } => {
    diagnostics.push({ plugin: pluginName, directory: pluginRoot, message: reason });
    return { servers, disabled: reason };
  };

  const mcpPath = resolveContainedExistingPath(
    pluginRoot,
    join(pluginRoot, "mcp.json"),
    "mcp.json",
    "file"
  );
  if (mcpPath.state === "missing") return { servers };
  if (mcpPath.state === "invalid") return disable(mcpPath.message);

  const read = readBoundedText(mcpPath.path, "mcp.json");
  if (read.error !== undefined) return disable(read.error);

  let doc: unknown;
  try {
    doc = JSON.parse(read.text!);
  } catch {
    return disable("mcp.json is not valid JSON");
  }
  if (!isPlainObject(doc)) return disable("mcp.json must contain a JSON object");

  const topLevelExtra = unknownFields(doc, MCP_TOP_LEVEL_FIELDS);
  if (topLevelExtra.length > 0) {
    return disable(
      `mcp.json contains unknown top-level field(s) ${topLevelExtra
        .map((key) => `"${key}"`)
        .join(", ")}`
    );
  }
  if (doc.$schema !== CANONICAL_MCP_SCHEMA) {
    return disable(
      `mcp.json has unsupported $schema ${JSON.stringify(doc.$schema)}; expected "${CANONICAL_MCP_SCHEMA}"`
    );
  }
  if (!isPlainObject(doc.mcpServers)) {
    return disable("mcp.json must contain an mcpServers object");
  }

  const ctx: McpContext = {
    pluginName,
    directory: pluginRoot,
    pluginRoot,
    pluginData,
    diagnostics,
  };
  const entries = Object.entries(doc.mcpServers);
  if (entries.length > MAX_MCP_SERVERS) {
    diagnostics.push({
      plugin: pluginName,
      directory: pluginRoot,
      message: `mcp.json declares ${entries.length} servers; only the first ${MAX_MCP_SERVERS} are loaded`,
    });
  }

  for (const [serverName, entry] of entries.slice(0, MAX_MCP_SERVERS)) {
    if (!isPlainObject(entry)) {
      reportServer(ctx, serverName, "server definition must be an object, skipped");
      continue;
    }
    const type = entry.type;
    if (type === "stdio") {
      const server = loadStdioServer(serverName, entry, ctx);
      if (server !== undefined) servers.push(server);
    } else if (type === "streamable-http" || type === "sse") {
      const server = loadHttpServer(serverName, type, entry, ctx);
      if (server === undefined) continue;
      if (server.type === "sse") {
        reportServer(ctx, serverName, 'type "sse" is deprecated and unsupported, skipped');
      } else {
        servers.push({
          name: server.name,
          type: "streamable-http",
          url: server.url,
          ...(server.headers === undefined ? {} : { headers: server.headers }),
        });
      }
    } else {
      reportServer(ctx, serverName, `missing or unknown type ${JSON.stringify(type)}, skipped`);
    }
  }
  return { servers };
}

function reportSkill(
  diagnostics: PluginDiagnostic[],
  pluginName: string,
  directory: string,
  skillName: string,
  message: string
): void {
  diagnostics.push({
    plugin: pluginName,
    directory,
    message: `skill "${skillName}": ${message}`,
  });
}

function loadPluginSkills(
  pluginRoot: string,
  source: "project" | "user",
  pluginName: string,
  diagnostics: PluginDiagnostic[]
): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const fixedLocation = resolveContainedExistingPath(
    pluginRoot,
    join(pluginRoot, "skills"),
    "skills fixed location",
    "directory"
  );
  if (fixedLocation.state === "missing") return skills;
  if (fixedLocation.state === "invalid") {
    diagnostics.push({ plugin: pluginName, directory: pluginRoot, message: fixedLocation.message });
    return skills;
  }

  let entries;
  try {
    entries = readdirSync(fixedLocation.path, { withFileTypes: true });
  } catch {
    diagnostics.push({
      plugin: pluginName,
      directory: pluginRoot,
      message: "skills fixed location is not readable",
    });
    return skills;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const skillDirectory = resolveContainedExistingPath(
      pluginRoot,
      join(fixedLocation.path, entry.name),
      `skill directory "${entry.name}"`,
      "directory"
    );
    if (skillDirectory.state !== "ok") {
      if (skillDirectory.state === "invalid" && skillDirectory.reason !== "wrong-kind") {
        reportSkill(
          diagnostics,
          pluginName,
          fixedLocation.path,
          entry.name,
          `${skillDirectory.message}, skipped`
        );
      }
      continue;
    }

    const skillMd = resolveContainedExistingPath(
      pluginRoot,
      join(skillDirectory.path, "SKILL.md"),
      "SKILL.md",
      "file"
    );
    if (skillMd.state !== "ok") {
      if (skillMd.state === "invalid" && skillMd.reason !== "wrong-kind") {
        reportSkill(
          diagnostics,
          pluginName,
          skillDirectory.path,
          entry.name,
          `${skillMd.message}, skipped`
        );
      }
      continue;
    }

    const result = loadSkillDirectory(skillDirectory.path, source, pluginName);
    for (const diagnostic of result.diagnostics) {
      diagnostics.push({
        plugin: pluginName,
        directory: diagnostic.directory,
        message: `skill "${diagnostic.skill ?? basename(diagnostic.directory)}": ${diagnostic.message}`,
      });
    }
    if (result.skill !== undefined) skills.push(result.skill);
  }
  return skills;
}

export function loadPlugin(
  directory: string,
  source: "project" | "user",
  home: string = homedir()
): { plugin?: LoadedPlugin; diagnostics: PluginDiagnostic[] } {
  const diagnostics: PluginDiagnostic[] = [];
  let diagnosticDirectory = resolve(directory);
  let identifier = basename(diagnosticDirectory);
  const report = (message: string): void => {
    diagnostics.push({ plugin: identifier, directory: diagnosticDirectory, message });
  };

  let pluginRoot: string;
  try {
    pluginRoot = realpathSync(diagnosticDirectory);
    if (!statSync(pluginRoot).isDirectory()) {
      report("plugin root must resolve to a directory");
      return { diagnostics };
    }
  } catch {
    report("plugin root is missing or not readable");
    return { diagnostics };
  }
  diagnosticDirectory = pluginRoot;
  identifier = basename(pluginRoot);

  const pluginJson = resolveContainedExistingPath(
    pluginRoot,
    join(pluginRoot, "plugin.json"),
    "plugin.json",
    "file"
  );
  if (pluginJson.state !== "ok") {
    report(pluginJson.message);
    return { diagnostics };
  }

  const read = readBoundedText(pluginJson.path, "plugin.json");
  if (read.error !== undefined) {
    report(read.error);
    return { diagnostics };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(read.text!);
  } catch {
    report("plugin.json is not valid JSON");
    return { diagnostics };
  }
  if (!isPlainObject(doc)) {
    report("plugin.json must contain a JSON object");
    return { diagnostics };
  }

  const nameError = validatePluginName(doc.name);
  if (nameError !== undefined) {
    report(`invalid plugin name: ${nameError}`);
    return { diagnostics };
  }
  const name = doc.name as string;
  identifier = name;

  if (doc.$schema !== CANONICAL_PLUGIN_SCHEMA) {
    report(
      `plugin.json has unsupported $schema ${JSON.stringify(doc.$schema)}; expected "${CANONICAL_PLUGIN_SCHEMA}"`
    );
    return { diagnostics };
  }

  for (const key of Object.keys(doc)) {
    if (!KNOWN_MANIFEST_FIELDS.has(key)) report(`unknown top-level field "${key}" ignored`);
  }

  for (const field of ["version", "description", "homepage", "repository", "license"] as const) {
    if (doc[field] !== undefined && typeof doc[field] !== "string") {
      report(`manifest field "${field}" must be a string`);
      return { diagnostics };
    }
  }

  if (doc.author !== undefined) {
    if (!isPlainObject(doc.author)) {
      report('manifest field "author" must be an object');
      return { diagnostics };
    }
    const extra = unknownFields(doc.author, KNOWN_AUTHOR_FIELDS);
    if (extra.length > 0) {
      report(
        `manifest field "author" contains unknown field(s) ${extra
          .map((field) => `"${field}"`)
          .join(", ")}`
      );
      return { diagnostics };
    }
    for (const field of ["name", "email", "url"] as const) {
      if (doc.author[field] !== undefined && typeof doc.author[field] !== "string") {
        report(`manifest field "author.${field}" must be a string`);
        return { diagnostics };
      }
    }
  }

  if (doc.keywords !== undefined) {
    if (!Array.isArray(doc.keywords) || doc.keywords.some((keyword) => typeof keyword !== "string")) {
      report('manifest field "keywords" must be an array of strings');
      return { diagnostics };
    }
  }

  let extensions: Record<string, unknown> | undefined;
  if (doc.extensions !== undefined) {
    if (isPlainObject(doc.extensions)) {
      extensions = doc.extensions;
    } else {
      report('manifest field "extensions" must be an object; field ignored');
    }
  }

  const manifest: PluginManifestDraft = { name };
  if (typeof doc.version === "string") manifest.version = doc.version;
  if (typeof doc.description === "string") manifest.description = doc.description;
  if (isPlainObject(doc.author)) {
    const author: { name?: string; email?: string; url?: string } = {};
    if (typeof doc.author.name === "string") author.name = doc.author.name;
    if (typeof doc.author.email === "string") author.email = doc.author.email;
    if (typeof doc.author.url === "string") author.url = doc.author.url;
    manifest.author = author;
  }
  if (typeof doc.homepage === "string") manifest.homepage = doc.homepage;
  if (typeof doc.repository === "string") manifest.repository = doc.repository;
  if (typeof doc.license === "string") manifest.license = doc.license;
  if (Array.isArray(doc.keywords)) manifest.keywords = doc.keywords as string[];
  if (extensions !== undefined) manifest.extensions = extensions;

  const dataDirectory = pluginDataDirectory(home, name);
  const skills = loadPluginSkills(pluginRoot, source, name, diagnostics);
  const mcp = loadMcpServers(pluginRoot, name, dataDirectory, diagnostics);

  const plugin: LoadedPlugin = {
    directory: pluginRoot,
    dataDirectory,
    source,
    name,
    manifest,
    skills,
    mcpServers: mcp.servers,
    diagnostics,
    ...(mcp.disabled === undefined ? {} : { mcpDisabled: mcp.disabled }),
  };
  return { plugin, diagnostics };
}
