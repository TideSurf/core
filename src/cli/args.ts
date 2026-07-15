import { resolve } from "node:path";
import {
  getToolCommandNames,
  getToolSpecByCommand,
  type ToolSpec,
} from "../tools/registry.js";
import type { ChromeChannel } from "../types.js";
import { validateSessionName, type SessionConfig } from "./session.js";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

type ValueKind = "string" | "number" | "boolean";

interface OptionDefinition {
  flag: string;
  property: string;
  kind: ValueKind;
  repeat?: boolean;
  startup?: boolean;
}

const GLOBAL_OPTIONS: readonly OptionDefinition[] = [
  { flag: "--session", property: "session", kind: "string" },
  { flag: "--json", property: "json", kind: "boolean" },
  { flag: "--quiet", property: "quiet", kind: "boolean" },
  { flag: "--headful", property: "headful", kind: "boolean", startup: true },
  { flag: "--auto-connect", property: "autoConnect", kind: "boolean", startup: true },
  { flag: "--connect-only", property: "connectOnly", kind: "boolean", startup: true },
  { flag: "--browser-url", property: "browserUrl", kind: "string", startup: true },
  { flag: "--host", property: "host", kind: "string", startup: true },
  { flag: "--port", property: "port", kind: "number", startup: true },
  { flag: "--chrome-path", property: "chromePath", kind: "string", startup: true },
  { flag: "--channel", property: "channel", kind: "string", startup: true },
  { flag: "--user-data-dir", property: "userDataDir", kind: "string", startup: true },
  { flag: "--read-only", property: "readOnly", kind: "boolean", startup: true },
  { flag: "--allow-localhost", property: "allowLocalhost", kind: "boolean", startup: true },
  { flag: "--allow-private-hosts", property: "allowPrivateHosts", kind: "boolean", startup: true },
  { flag: "--file-access-root", property: "fileAccessRoots", kind: "string", repeat: true, startup: true },
  { flag: "--timeout", property: "sessionTimeout", kind: "number", startup: true },
] as const;

const GLOBAL_BY_FLAG = new Map(GLOBAL_OPTIONS.map((option) => [option.flag, option]));
const LIFECYCLE_COMMAND_NAMES = [
  "start",
  "status",
  "stop",
  "tools",
  "call",
  "inspect",
  "mcp",
  "help",
] as const;
const LIFECYCLE_COMMANDS = new Set<string>(LIFECYCLE_COMMAND_NAMES);

export function availableCommandNames(): string[] {
  return [...LIFECYCLE_COMMAND_NAMES, ...getToolCommandNames()];
}

export function unknownCommandError(command: string): CliUsageError {
  return new CliUsageError(
    `Unknown command: ${command}. Available commands: ${availableCommandNames().join(", ")}.`
  );
}

export interface ParsedInvocation {
  command?: string;
  tool?: ToolSpec;
  positionals: string[];
  values: Record<string, unknown>;
  session: string;
  json: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
  sessionConfig: SessionConfig;
  startupConfig: Partial<SessionConfig>;
  screenshotOutput?: string;
  callInput?: string;
}

function optionValue(token: string): { flag: string; inline?: string } {
  const equals = token.indexOf("=");
  return equals === -1
    ? { flag: token }
    : { flag: token.slice(0, equals), inline: token.slice(equals + 1) };
}

function findCommand(argv: string[]): { command?: string; index: number } {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") return { command: argv[i + 1], index: i + 1 };
    if (token === "-h" || token === "--help" || token === "-V" || token === "--version") {
      continue;
    }
    if (token.startsWith("--")) {
      const { flag, inline } = optionValue(token);
      const definition = GLOBAL_BY_FLAG.get(flag) ??
        (flag.startsWith("--no-") ? GLOBAL_BY_FLAG.get(`--${flag.slice(5)}`) : undefined);
      if (!definition) throw new CliUsageError(`Unknown option: ${flag}`);
      if (definition.kind !== "boolean" && inline === undefined) i++;
      if (
        definition.kind === "boolean" &&
        inline === undefined &&
        (argv[i + 1] === "true" || argv[i + 1] === "false")
      ) {
        i++;
      }
      continue;
    }
    if (token.startsWith("-")) throw new CliUsageError(`Unknown option: ${token}`);
    return { command: token, index: i };
  }
  return { index: -1 };
}

function parseNumber(raw: string, flag: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new CliUsageError(`${flag} requires a finite number`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliUsageError(`${flag} requires a finite number`);
  return value;
}

function parseBoolean(raw: string, flag: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CliUsageError(`${flag} expects true or false`);
}

function setValue(
  values: Record<string, unknown>,
  definition: OptionDefinition,
  value: unknown
): void {
  if (definition.repeat) {
    const current = values[definition.property];
    values[definition.property] = [
      ...(Array.isArray(current) ? current : []),
      value,
    ];
  } else {
    if (values[definition.property] !== undefined) {
      throw new CliUsageError(`${definition.flag} may only be supplied once`);
    }
    values[definition.property] = value;
  }
}

function toolOptionDefinitions(tool?: ToolSpec): OptionDefinition[] {
  if (!tool) return [];
  return tool.cli.options.map((option) => ({
    flag: option.flag,
    property: option.property,
    kind: option.kind,
  }));
}

export function parseInvocation(argv: string[]): ParsedInvocation {
  const { command, index: commandIndex } = findCommand(argv);
  const tool = command ? getToolSpecByCommand(command) : undefined;
  if (command && !tool && !LIFECYCLE_COMMANDS.has(command)) {
    throw unknownCommandError(command);
  }

  const localDefinitions = toolOptionDefinitions(tool);
  if (command === "call") {
    localDefinitions.push({ flag: "--input", property: "callInput", kind: "string" });
  }
  if (command === "inspect") {
    localDefinitions.push(
      { flag: "--max-tokens", property: "maxTokens", kind: "number" },
      { flag: "--mode", property: "mode", kind: "string" },
      { flag: "--full-page", property: "fullPage", kind: "boolean" },
      { flag: "--include-hidden", property: "includeHidden", kind: "boolean" }
    );
  }

  const localByFlag = new Map(
    localDefinitions.map((definition) => [definition.flag, definition])
  );
  const values: Record<string, unknown> = {};
  const positionals: string[] = [];
  let help = false;
  let version = false;
  const explicitStartupProperties = new Set<string>();
  let afterDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    if (i === commandIndex) continue;
    const token = argv[i];
    if (afterDoubleDash) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      help = true;
      continue;
    }
    if (token === "-V" || token === "--version") {
      version = true;
      continue;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const parsed = optionValue(token);
    const beforeCommand = commandIndex !== -1 && i < commandIndex;
    let definition = beforeCommand
      ? GLOBAL_BY_FLAG.get(parsed.flag)
      : localByFlag.get(parsed.flag) ?? GLOBAL_BY_FLAG.get(parsed.flag);
    let negated = false;
    if (!definition && parsed.flag.startsWith("--no-")) {
      const positive = `--${parsed.flag.slice(5)}`;
      definition = beforeCommand
        ? GLOBAL_BY_FLAG.get(positive)
        : localByFlag.get(positive) ?? GLOBAL_BY_FLAG.get(positive);
      negated = true;
    }
    if (!definition) throw new CliUsageError(`Unknown option: ${parsed.flag}`);
    if (negated && definition.kind !== "boolean") {
      throw new CliUsageError(`${parsed.flag} cannot be negated`);
    }
    if (definition.startup) {
      explicitStartupProperties.add(definition.property);
    }

    if (definition.kind === "boolean") {
      const raw = parsed.inline ??
        (argv[i + 1] === "true" || argv[i + 1] === "false"
          ? argv[++i]
          : undefined);
      const positive = raw === undefined ? true : parseBoolean(raw, parsed.flag);
      const value = negated ? !positive : positive;
      setValue(values, definition, value);
      continue;
    }

    const raw = parsed.inline ?? argv[++i];
    if (raw === undefined) throw new CliUsageError(`${parsed.flag} requires a value`);
    setValue(
      values,
      definition,
      definition.kind === "number" ? parseNumber(raw, parsed.flag) : raw
    );
  }

  const port = values["port"] as number | undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new CliUsageError("--port must be an integer between 1 and 65535");
  }
  const sessionTimeout = values["sessionTimeout"] as number | undefined;
  if (
    sessionTimeout !== undefined &&
    (!Number.isInteger(sessionTimeout) || sessionTimeout <= 0)
  ) {
    throw new CliUsageError("--timeout must be a positive integer");
  }
  const toolTimeout = values["timeout"] as number | undefined;
  if (toolTimeout !== undefined && (!Number.isInteger(toolTimeout) || toolTimeout <= 0)) {
    throw new CliUsageError("--timeout must be a positive integer");
  }
  const channel = values["channel"] as ChromeChannel | undefined;
  if (channel && !["stable", "beta", "dev", "canary", "chromium"].includes(channel)) {
    throw new CliUsageError("--channel must be stable, beta, dev, canary, or chromium");
  }
  if (values["autoConnect"] && values["connectOnly"]) {
    throw new CliUsageError("--auto-connect and --connect-only cannot be combined");
  }
  if (values["browserUrl"] !== undefined && values["host"] !== undefined) {
    throw new CliUsageError("--browser-url and --host cannot be combined");
  }
  if (values["browserUrl"] !== undefined && values["port"] !== undefined) {
    throw new CliUsageError("--browser-url and --port cannot be combined");
  }
  if (values["host"] === "") {
    throw new CliUsageError("--host must be non-empty");
  }

  const rawSession = String(values["session"] ?? "default");
  let session: string;
  try {
    session = validateSessionName(rawSession);
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }

  const explicitConnection = values["browserUrl"] !== undefined || values["host"] !== undefined;
  const browserMode: SessionConfig["browserMode"] = values["connectOnly"]
    ? "connect"
    : values["autoConnect"]
      ? "auto"
      : explicitConnection
        ? "connect"
        : "launch";
  const roots = values["fileAccessRoots"] as string[] | undefined;
  const fileAccessRoots = roots
    ? [...new Set(roots.map((root) => resolve(root)))].sort()
    : undefined;
  const sessionConfig: SessionConfig = {
    browserMode,
    headless: !values["headful"],
    host: values["host"] as string | undefined,
    port,
    browserUrl: values["browserUrl"] as string | undefined,
    chromePath: values["chromePath"] ? resolve(String(values["chromePath"])) : undefined,
    channel,
    userDataDir: values["userDataDir"] ? resolve(String(values["userDataDir"])) : undefined,
    timeout: sessionTimeout,
    readOnly: Boolean(values["readOnly"]),
    allowLocalhost: Boolean(values["allowLocalhost"]),
    allowPrivateHosts: Boolean(values["allowPrivateHosts"]),
    fileAccessRoots,
  };
  const startupConfig: Partial<SessionConfig> = {};
  if (
    ["autoConnect", "connectOnly", "browserUrl", "host"].some((property) =>
      explicitStartupProperties.has(property)
    )
  ) {
    startupConfig.browserMode = sessionConfig.browserMode;
  }
  if (explicitStartupProperties.has("headful")) {
    startupConfig.headless = sessionConfig.headless;
  }
  const directStartupProperties = [
    ["host", "host"],
    ["port", "port"],
    ["browserUrl", "browserUrl"],
    ["chromePath", "chromePath"],
    ["channel", "channel"],
    ["userDataDir", "userDataDir"],
    ["sessionTimeout", "timeout"],
    ["readOnly", "readOnly"],
    ["allowLocalhost", "allowLocalhost"],
    ["allowPrivateHosts", "allowPrivateHosts"],
    ["fileAccessRoots", "fileAccessRoots"],
  ] as const;
  for (const [parsedProperty, configProperty] of directStartupProperties) {
    if (explicitStartupProperties.has(parsedProperty)) {
      Object.assign(startupConfig, {
        [configProperty]: sessionConfig[configProperty],
      });
    }
  }

  return {
    command,
    tool,
    positionals,
    values,
    session,
    json: Boolean(values["json"]),
    quiet: Boolean(values["quiet"]),
    help,
    version,
    sessionConfig,
    startupConfig,
    screenshotOutput: values["screenshotOutput"] as string | undefined,
    callInput: values["callInput"] as string | undefined,
  };
}

export function buildToolInput(invocation: ParsedInvocation): Record<string, unknown> {
  const tool = invocation.tool;
  if (!tool) throw new CliUsageError("A tool command is required");
  const input: Record<string, unknown> = {};

  let positionalIndex = 0;
  for (const positional of tool.cli.positionals) {
    const value = invocation.positionals[positionalIndex];
    if (value === undefined) {
      if (positional.required !== false) {
        throw new CliUsageError(`Missing ${positional.name}`);
      }
      continue;
    }
    input[positional.name] = positional.resolvePath ? resolve(value) : value;
    positionalIndex++;
  }
  if (positionalIndex < invocation.positionals.length) {
    throw new CliUsageError(`Unexpected argument: ${invocation.positionals[positionalIndex]}`);
  }

  for (const option of tool.cli.options) {
    if (invocation.values[option.property] !== undefined) {
      const rawValue = invocation.values[option.property];
      const value = option.resolvePath && typeof rawValue === "string"
        ? resolve(rawValue)
        : rawValue;
      if (
        value === true &&
        option.conflictsWith?.some((property) => invocation.values[property] === true)
      ) {
        throw new CliUsageError(
          `${option.flag} conflicts with ${option.conflictsWith
            .map((property) => tool.cli.options.find((item) => item.property === property)?.flag ?? property)
            .join(", ")}`
        );
      }
      if (option.input === false) continue;
      if (option.input) {
        if (option.kind === "boolean" && value === false) continue;
        input[option.input.property] = option.input.value;
      } else {
        input[option.property] = value;
      }
    }
  }
  return input;
}

export function normalizeCliPaths(
  tool: ToolSpec,
  input: Record<string, unknown>
): Record<string, unknown> {
  let output = input;
  const pathProperties = [
    ...tool.cli.positionals.filter((item) => item.resolvePath).map((item) => item.name),
    ...tool.cli.options.filter((item) => item.resolvePath).map((item) => item.property),
  ];
  for (const property of pathProperties) {
    const value = output[property];
    if (typeof value !== "string") continue;
    if (output === input) output = { ...input };
    output[property] = resolve(value);
  }
  return output;
}
