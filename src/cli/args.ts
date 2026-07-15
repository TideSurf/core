import { resolve } from "node:path";
import {
  getToolNames,
  getToolSpec,
  type ToolSpec,
} from "../tools/registry.js";
import { CHROME_CHANNELS, type ChromeChannel } from "../types.js";
import {
  GLOBAL_OPTIONS,
  LIFECYCLE_COMMANDS,
  type GlobalOptionSpec,
} from "./metadata.js";
import type { SessionConfig } from "./session.js";
import { isValidSessionName, SESSION_NAME_ERROR } from "./session-name.js";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

type OptionDefinition = Pick<
  GlobalOptionSpec,
  "flag" | "property" | "kind" | "repeat" | "startup"
>;

const GLOBAL_BY_FLAG = new Map<string, GlobalOptionSpec>(
  GLOBAL_OPTIONS.map((option) => [option.flag, option])
);
const LIFECYCLE_COMMAND_NAMES = LIFECYCLE_COMMANDS.map(({ name }) => name);
const LIFECYCLE_COMMAND_SET = new Set<string>(LIFECYCLE_COMMAND_NAMES);
const AVAILABLE_COMMAND_LIST = [...LIFECYCLE_COMMAND_NAMES, ...getToolNames()].join(", ");

export function unknownCommandError(command: string): CliUsageError {
  return new CliUsageError(
    `Unknown command: ${command}. Available commands: ${AVAILABLE_COMMAND_LIST}.`
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

const EMPTY_LOCAL_OPTIONS = new Map<string, OptionDefinition>();
const CALL_OPTIONS = new Map<string, OptionDefinition>([
  ["--input", { flag: "--input", property: "callInput", kind: "string" }],
]);
const TOOL_OPTIONS = new WeakMap<ToolSpec, ReadonlyMap<string, OptionDefinition>>();
let inspectOptions: ReadonlyMap<string, OptionDefinition> | undefined;

function optionMap(
  definitions: readonly OptionDefinition[]
): ReadonlyMap<string, OptionDefinition> {
  const options = new Map<string, OptionDefinition>();
  for (const definition of definitions) options.set(definition.flag, definition);
  return options;
}

function localOptions(
  command: string | undefined,
  tool: ToolSpec | undefined
): ReadonlyMap<string, OptionDefinition> {
  if (tool) {
    let options = TOOL_OPTIONS.get(tool);
    if (!options) {
      options = optionMap(tool.cli.options);
      TOOL_OPTIONS.set(tool, options);
    }
    return options;
  }
  if (command === "call") return CALL_OPTIONS;
  if (command !== "inspect") return EMPTY_LOCAL_OPTIONS;
  if (!inspectOptions) {
    const stateTool = getToolSpec("get_state");
    inspectOptions = stateTool
      ? optionMap(stateTool.cli.options.filter(({ property }) => property !== "viewport"))
      : EMPTY_LOCAL_OPTIONS;
  }
  return inspectOptions;
}

export function parseInvocation(argv: string[]): ParsedInvocation {
  const { command, index: commandIndex } = findCommand(argv);
  const tool = command ? getToolSpec(command) : undefined;
  if (command && !tool && !LIFECYCLE_COMMAND_SET.has(command)) {
    throw unknownCommandError(command);
  }

  const localByFlag = localOptions(command, tool);
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
  if (channel !== undefined && !CHROME_CHANNELS.includes(channel)) {
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
  if (values["browserUrl"] === "") {
    throw new CliUsageError("--browser-url must be non-empty");
  }
  if (values["chromePath"] === "") {
    throw new CliUsageError("--chrome-path must be non-empty");
  }
  if (values["userDataDir"] === "") {
    throw new CliUsageError("--user-data-dir must be non-empty");
  }

  const acceptsStartupOptions = tool !== undefined ||
    command === "start" ||
    command === "call" ||
    command === "inspect" ||
    command === "mcp";
  if (!acceptsStartupOptions && explicitStartupProperties.size > 0) {
    const property = explicitStartupProperties.values().next().value as string;
    const flag = GLOBAL_OPTIONS.find((option) => option.property === property)?.flag;
    throw new CliUsageError(`${flag ?? property} is not valid for ${command ?? "help"}`);
  }
  if (values["quiet"] !== undefined && command !== "mcp") {
    throw new CliUsageError("--quiet is only valid for mcp");
  }
  if (
    values["session"] !== undefined &&
    !tool &&
    command !== "start" &&
    command !== "status" &&
    command !== "stop" &&
    command !== "call"
  ) {
    throw new CliUsageError(`--session is not valid for ${command ?? "help"}`);
  }
  if (
    values["json"] !== undefined &&
    (command === undefined || command === "help" || command === "mcp" || version)
  ) {
    throw new CliUsageError(`--json is not valid for ${version ? "--version" : command ?? "help"}`);
  }

  const rawSession = String(values["session"] ?? "default");
  if (!isValidSessionName(rawSession)) throw new CliUsageError(SESSION_NAME_ERROR);
  const session = rawSession;

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
    chromePath: values["chromePath"] !== undefined
      ? resolve(String(values["chromePath"]))
      : undefined,
    channel,
    userDataDir: values["userDataDir"] !== undefined
      ? resolve(String(values["userDataDir"]))
      : undefined,
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
  for (const option of GLOBAL_OPTIONS) {
    if (
      option.configProperty &&
      explicitStartupProperties.has(option.property)
    ) {
      Object.assign(startupConfig, {
        [option.configProperty]: sessionConfig[option.configProperty],
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
  const normalize = (property: string) => {
    const value = output[property];
    if (typeof value !== "string") return;
    if (output === input) output = { ...input };
    output[property] = resolve(value);
  };
  for (const positional of tool.cli.positionals) {
    if (positional.resolvePath) normalize(positional.name);
  }
  for (const option of tool.cli.options) {
    if (!option.resolvePath) continue;
    normalize(typeof option.input === "object"
      ? option.input.property
      : option.property);
  }
  return output;
}
