import { resolve } from "node:path";
import { ValidationError } from "../errors.js";
import {
  getToolNames,
  getToolSpec,
  type ToolSpec,
} from "../tools/registry.js";
import { CHROME_CHANNELS, type ChromeChannel } from "../types.js";
import { validatePort, validateTimeout } from "../validation.js";
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

interface ResolvedFlag {
  flag: string;
  definition: OptionDefinition;
  negated: boolean;
  raw?: string;
}

function resolveFlag(
  argv: string[],
  index: number,
  lookup: (flag: string) => OptionDefinition | undefined
): { resolved: ResolvedFlag; nextIndex: number } {
  const { flag, inline } = optionValue(argv[index]);
  let definition = lookup(flag);
  let negated = false;
  if (!definition && flag.startsWith("--no-")) {
    definition = lookup(`--${flag.slice(5)}`);
    negated = true;
  }
  if (!definition) throw new CliUsageError(`Unknown option: ${flag}`);
  let raw = inline;
  let nextIndex = index + 1;
  if (definition.kind === "boolean") {
    if (raw === undefined && (argv[nextIndex] === "true" || argv[nextIndex] === "false")) {
      raw = argv[nextIndex];
      nextIndex++;
    }
  } else if (raw === undefined) {
    raw = argv[nextIndex];
    nextIndex++;
  }
  return { resolved: { flag, definition, negated, raw }, nextIndex };
}

function applyFlag(
  resolved: ResolvedFlag,
  values: Record<string, unknown>,
  explicitStartupProperties: Set<string>
): void {
  const { flag, definition, negated, raw } = resolved;
  if (negated && definition.kind !== "boolean") {
    throw new CliUsageError(`${flag} cannot be negated`);
  }
  if (definition.startup) explicitStartupProperties.add(definition.property);
  if (definition.kind === "boolean") {
    const positive = raw === undefined ? true : parseBoolean(raw, flag);
    setValue(values, definition, negated ? !positive : positive);
    return;
  }
  if (raw === undefined) throw new CliUsageError(`${flag} requires a value`);
  setValue(
    values,
    definition,
    definition.kind === "number" ? parseNumber(raw, flag) : raw
  );
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

function usageCheck(check: () => void): void {
  try {
    check();
  } catch (error) {
    if (error instanceof ValidationError) throw new CliUsageError(error.message);
    throw error;
  }
}

export function parseInvocation(argv: string[]): ParsedInvocation {
  const preCommand: ResolvedFlag[] = [];
  let command: string | undefined;
  let restIndex = argv.length;
  let afterDoubleDash = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; ) {
    const token = argv[i];
    if (token === "--") {
      command = argv[i + 1];
      restIndex = i + 2;
      afterDoubleDash = true;
      break;
    }
    if (token === "-h" || token === "--help") {
      help = true;
      i++;
      continue;
    }
    if (token === "-V" || token === "--version") {
      version = true;
      i++;
      continue;
    }
    if (!token.startsWith("-")) {
      command = token;
      restIndex = i + 1;
      break;
    }
    const { resolved, nextIndex } = resolveFlag(argv, i, (flag) => GLOBAL_BY_FLAG.get(flag));
    preCommand.push(resolved);
    i = nextIndex;
  }

  const tool = command ? getToolSpec(command) : undefined;
  if (command && !tool && !LIFECYCLE_COMMAND_SET.has(command)) {
    throw unknownCommandError(command);
  }

  const localByFlag = localOptions(command, tool);
  const values: Record<string, unknown> = {};
  const positionals: string[] = [];
  const explicitStartupProperties = new Set<string>();

  for (const resolved of preCommand) {
    applyFlag(resolved, values, explicitStartupProperties);
  }

  for (let i = restIndex; i < argv.length; ) {
    const token = argv[i];
    if (afterDoubleDash) {
      positionals.push(token);
      i++;
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      i++;
      continue;
    }
    if (token === "-h" || token === "--help") {
      help = true;
      i++;
      continue;
    }
    if (token === "-V" || token === "--version") {
      version = true;
      i++;
      continue;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      i++;
      continue;
    }
    const { resolved, nextIndex } = resolveFlag(
      argv,
      i,
      (flag) => localByFlag.get(flag) ?? GLOBAL_BY_FLAG.get(flag)
    );
    applyFlag(resolved, values, explicitStartupProperties);
    i = nextIndex;
  }

  const port = values["port"] as number | undefined;
  if (port !== undefined) usageCheck(() => validatePort(port));
  const sessionTimeout = values["sessionTimeout"] as number | undefined;
  if (sessionTimeout !== undefined) {
    usageCheck(() => validateTimeout(sessionTimeout, "--timeout"));
  }
  const toolTimeout = values["timeout"] as number | undefined;
  if (toolTimeout !== undefined) {
    usageCheck(() => validateTimeout(toolTimeout, "--timeout"));
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

/**
 * Decide the error-path output format. Uses the real parse whenever it
 * succeeds so the decision matches the invocation; when the parse itself
 * fails, falls back to a tolerant scan with the same global flag
 * consumption rules that never throws.
 */
export function jsonOutputRequested(argv: string[]): boolean {
  try {
    return parseInvocation(argv).json;
  } catch {
    let json = false;
    for (let i = 0; i < argv.length; ) {
      const token = argv[i];
      if (token === "--") break;
      if (!token.startsWith("-")) {
        i++;
        continue;
      }
      let step: ReturnType<typeof resolveFlag>;
      try {
        step = resolveFlag(argv, i, (flag) => GLOBAL_BY_FLAG.get(flag));
      } catch {
        i++;
        continue;
      }
      i = step.nextIndex;
      const { definition, negated, raw } = step.resolved;
      if (definition.property !== "json") continue;
      const positive = raw !== "false";
      json = negated ? !positive : positive;
    }
    return json;
  }
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
