import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { loadSkillDirectory } from "./skills.js";
import type { SkillInfo } from "./skills.js";

const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-.]*[a-z0-9])?$/;
const CANONICAL_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const COMMAND_TOKEN_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const COMMAND_FORBIDDEN_PATTERN = /[\s;&|<>()$`{}\[\]!#]/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const SCHEMA_VERSION_PATTERN = /\d+\.\d+\.\d+/;
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
const STDIO_SERVER_FIELDS = new Set(["type", "command", "args", "env", "cwd"]);
const HTTP_SERVER_FIELDS = new Set(["type", "url", "headers"]);
const MCP_TOP_LEVEL_FIELDS = new Set(["$schema", "mcpServers"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  readonly directory: string;
  readonly source: "project" | "user";
  readonly name: string;
  readonly manifest: PluginManifest;
  readonly skills: readonly SkillInfo[];
  readonly mcpServers: readonly PluginMcpServer[];
  readonly diagnostics: readonly PluginDiagnostic[];
  readonly mcpDisabled?: string;
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
  type: "streamable-http";
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

export function pluginDataDirectory(home: string, pluginName: string): string {
  return join(home, ".tidesurf", "plugin-data", pluginName);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaVersion(schema: unknown): string | undefined {
  return typeof schema === "string" ? (SCHEMA_VERSION_PATTERN.exec(schema)?.[0]) : undefined;
}

// Symlinks anywhere under the plugin root must not smuggle cwd outside it, so
// containment is checked on canonical paths; walk up to the nearest existing
// ancestor when the target itself does not exist yet.
function canonicalPath(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    if (existsSync(current)) {
      try {
        current = realpathSync(current);
      } catch {
        // Keep the lexical path when realpath fails.
      }
      return missing.length === 0 ? current : join(current, ...missing);
    }
    const parent = dirname(current);
    if (parent === current) return resolve(target);
    missing.unshift(basename(current));
    current = parent;
  }
}

// Single pass over the input: placeholder text produced by an expansion (for
// example a home directory literally containing "${PLUGIN_ROOT}") is never
// re-expanded. Returns null on any other ${...} token.
function expandPlaceholders(
  value: string,
  pluginRoot: string,
  pluginData: string
): string | null {
  let valid = true;
  const expanded = value.replace(/\$\{([^}]*)\}/g, (token: string, name: string) => {
    if (name === "PLUGIN_ROOT") return pluginRoot;
    if (name === "PLUGIN_DATA") return pluginData;
    valid = false;
    return token;
  });
  if (!valid) return null;
  const residue = value.replace(/\$\{(?:PLUGIN_ROOT|PLUGIN_DATA)\}/g, "");
  if (residue.includes("${")) return null;
  return expanded;
}

function validateCommand(command: unknown): { command: string } | { error: string } {
  if (typeof command !== "string" || command === "") {
    return { error: 'type "stdio" requires a command string' };
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
  if (COMMAND_TOKEN_PATTERN.test(command) || command.startsWith("./")) {
    return { command };
  }
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

function reportUnknownFields(
  ctx: McpContext,
  serverName: string,
  entry: Record<string, unknown>,
  known: ReadonlySet<string>
): void {
  const unknown = Object.keys(entry).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    reportServer(ctx, serverName, `unknown field(s) ${unknown.map((key) => `"${key}"`).join(", ")} ignored`);
  }
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

  const commandResult = validateCommand(entry.command);
  if ("error" in commandResult) return fail(commandResult.error);

  let args: string[] | undefined;
  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string")) {
      return fail("args must be an array of strings");
    }
    args = [];
    for (const arg of entry.args as string[]) {
      const expanded = expandPlaceholders(arg, ctx.pluginRoot, ctx.pluginData);
      if (expanded === null) {
        return fail("args may only contain ${PLUGIN_ROOT} and ${PLUGIN_DATA} placeholders");
      }
      args.push(expanded);
    }
  }

  let env: Record<string, string> | undefined;
  if (entry.env !== undefined) {
    if (!isPlainObject(entry.env)) return fail("env must be an object mapping strings to strings");
    env = {};
    for (const [key, value] of Object.entries(entry.env)) {
      if (typeof value !== "string") return fail(`env.${key} must be a string`);
      const expanded = expandPlaceholders(value, ctx.pluginRoot, ctx.pluginData);
      if (expanded === null) {
        return fail(`env.${key} may only contain \${PLUGIN_ROOT} and \${PLUGIN_DATA} placeholders`);
      }
      env[key] = expanded;
    }
  }

  let cwd: string | undefined;
  if (entry.cwd !== undefined) {
    if (typeof entry.cwd !== "string") return fail("cwd must be a string");
    const expanded = expandPlaceholders(entry.cwd, ctx.pluginRoot, ctx.pluginData);
    if (expanded === null) {
      return fail("cwd may only contain ${PLUGIN_ROOT} and ${PLUGIN_DATA} placeholders");
    }
    const resolvedCwd = isAbsolute(expanded) ? resolve(expanded) : resolve(ctx.pluginRoot, expanded);
    const rootCanonical = canonicalPath(ctx.pluginRoot);
    const cwdCanonical = canonicalPath(resolvedCwd);
    if (cwdCanonical !== rootCanonical && !cwdCanonical.startsWith(rootCanonical + sep)) {
      return fail(`cwd "${entry.cwd}" resolves outside the plugin root`);
    }
    cwd = resolvedCwd;
  }

  reportUnknownFields(ctx, name, entry, STDIO_SERVER_FIELDS);

  const server: StdioServerDraft = {
    name,
    type: "stdio",
    command: commandResult.command,
    cwd: cwd ?? ctx.pluginRoot,
  };
  if (args !== undefined) server.args = args;
  if (env !== undefined) server.env = env;
  return server;
}

function loadHttpServer(
  name: string,
  entry: Record<string, unknown>,
  ctx: McpContext
): PluginMcpServer | undefined {
  const fail = (message: string): undefined => {
    reportServer(ctx, name, message);
    return undefined;
  };

  if (typeof entry.url !== "string" || entry.url === "") {
    return fail('type "streamable-http" requires a url string');
  }
  const url = entry.url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`url "${url}" is not a valid URL`);
  }
  const loopbackHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackHttp) {
    return fail(`url "${url}" must use https (http is only allowed for loopback hosts)`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return fail(`url "${url}" must not contain user info`);
  }
  if (parsed.hash !== "") {
    return fail(`url "${url}" must not contain a fragment`);
  }

  let headers: Record<string, string> | undefined;
  if (entry.headers !== undefined) {
    if (!isPlainObject(entry.headers)) {
      return fail("headers must be an object mapping strings to strings");
    }
    headers = {};
    for (const [key, value] of Object.entries(entry.headers)) {
      if (typeof value !== "string") return fail(`headers.${key} must be a string`);
      headers[key] = value;
    }
  }

  reportUnknownFields(ctx, name, entry, HTTP_SERVER_FIELDS);

  const server: HttpServerDraft = { name, type: "streamable-http", url };
  if (headers !== undefined) server.headers = headers;
  return server;
}

function loadMcpServers(
  directory: string,
  pluginName: string,
  pluginSchema: unknown,
  home: string,
  diagnostics: PluginDiagnostic[]
): { servers: PluginMcpServer[]; disabled?: string } {
  const servers: PluginMcpServer[] = [];
  const mcpPath = join(directory, "mcp.json");
  if (!existsSync(mcpPath)) return { servers };

  const disable = (reason: string): { servers: PluginMcpServer[]; disabled: string } => {
    diagnostics.push({ plugin: pluginName, directory, message: reason });
    return { servers, disabled: reason };
  };

  let raw: string;
  try {
    raw = readFileSync(mcpPath, "utf8");
  } catch {
    return disable("mcp.json is not readable");
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return disable("mcp.json is not valid JSON");
  }
  if (!isPlainObject(doc)) return disable("mcp.json must contain a JSON object");
  for (const key of Object.keys(doc)) {
    if (!MCP_TOP_LEVEL_FIELDS.has(key)) {
      diagnostics.push({
        plugin: pluginName,
        directory,
        message: `mcp.json: unknown top-level field "${key}" ignored`,
      });
    }
  }

  const pluginVersion = schemaVersion(pluginSchema);
  const mcpVersion = schemaVersion(doc.$schema);
  if (pluginVersion !== undefined && mcpVersion !== undefined && pluginVersion !== mcpVersion) {
    return disable(
      `mcp.json $schema version ${mcpVersion} does not match plugin.json $schema version ${pluginVersion}`
    );
  }

  if (!isPlainObject(doc.mcpServers)) {
    return disable("mcp.json does not contain an mcpServers object");
  }

  const ctx: McpContext = {
    pluginName,
    directory,
    pluginRoot: resolve(directory),
    pluginData: pluginDataDirectory(home, pluginName),
    diagnostics,
  };
  for (const [serverName, entry] of Object.entries(doc.mcpServers)) {
    if (serverName === "") {
      diagnostics.push({
        plugin: pluginName,
        directory,
        message: "mcp server name must be a non-empty string, skipping entry",
      });
      continue;
    }
    if (!isPlainObject(entry)) {
      reportServer(ctx, serverName, "server definition must be an object, skipping");
      continue;
    }
    const type = entry.type;
    if (type === "stdio") {
      const server = loadStdioServer(serverName, entry, ctx);
      if (server !== undefined) servers.push(server);
    } else if (type === "streamable-http") {
      const server = loadHttpServer(serverName, entry, ctx);
      if (server !== undefined) servers.push(server);
    } else if (type === "sse") {
      reportServer(ctx, serverName, 'type "sse" is deprecated, skipped');
    } else {
      reportServer(ctx, serverName, `missing or unknown type ${JSON.stringify(type)}, skipping`);
    }
  }
  return { servers };
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function loadPluginSkills(
  directory: string,
  source: "project" | "user",
  pluginName: string,
  diagnostics: PluginDiagnostic[]
): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const skillsDir = join(directory, "skills");
  let entries;
  try {
    if (!statSync(skillsDir).isDirectory()) return skills;
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const skillDir = join(skillsDir, entry.name);
    // Symlinked skill directories are a standard install layout.
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue;
      try {
        if (!statSync(skillDir).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    if (!isRegularFile(join(skillDir, "SKILL.md"))) continue;
    const result = loadSkillDirectory(skillDir, source, pluginName);
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
  let identifier = basename(directory);
  const report = (message: string): void => {
    diagnostics.push({ plugin: identifier, directory, message });
  };

  let raw: string;
  try {
    raw = readFileSync(join(directory, "plugin.json"), "utf8");
  } catch {
    report("plugin.json is missing or not readable");
    return { diagnostics };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
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

  if (typeof doc.$schema !== "string") {
    report("plugin.json requires a $schema string");
    return { diagnostics };
  }
  if (doc.$schema !== CANONICAL_PLUGIN_SCHEMA) {
    report(`unrecognized $schema "${doc.$schema}", continuing with v1 rules`);
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
  if (doc.extensions !== undefined && !isPlainObject(doc.extensions)) {
    report('manifest field "extensions" must be an object');
    return { diagnostics };
  }
  for (const key of Object.keys(doc)) {
    if (!KNOWN_MANIFEST_FIELDS.has(key)) {
      report(`unknown top-level field "${key}" ignored`);
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
  if (Array.isArray(doc.keywords)) {
    manifest.keywords = doc.keywords.filter(
      (keyword): keyword is string => typeof keyword === "string"
    );
  }
  if (isPlainObject(doc.extensions)) manifest.extensions = doc.extensions;

  const skills = loadPluginSkills(directory, source, name, diagnostics);
  const mcp = loadMcpServers(directory, name, doc.$schema, home, diagnostics);

  const plugin: LoadedPlugin = {
    directory,
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
