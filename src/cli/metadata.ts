import type { SessionConfig } from "./session.js";

type CliValueKind = "string" | "number" | "boolean";

export interface GlobalOptionSpec {
  readonly flag: string;
  readonly property: string;
  readonly kind: CliValueKind;
  readonly description: string;
  readonly metavar?: string;
  readonly repeat?: boolean;
  readonly startup?: boolean;
  readonly configProperty?: keyof SessionConfig;
}

export const GLOBAL_OPTIONS: readonly GlobalOptionSpec[] = [
  {
    flag: "--session",
    property: "session",
    kind: "string",
    metavar: "name",
    description: "Select a named session (default: default)",
  },
  {
    flag: "--json",
    property: "json",
    kind: "boolean",
    description: "Emit the ToolResult JSON shape",
  },
  {
    flag: "--quiet",
    property: "quiet",
    kind: "boolean",
    description: "Suppress the MCP ready message",
  },
  {
    flag: "--headful",
    property: "headful",
    kind: "boolean",
    description: "Show the managed browser window",
    startup: true,
  },
  {
    flag: "--auto-connect",
    property: "autoConnect",
    kind: "boolean",
    description: "Try attach discovery, then launch locally",
    startup: true,
  },
  {
    flag: "--connect-only",
    property: "connectOnly",
    kind: "boolean",
    description: "Attach without launching a browser",
    startup: true,
  },
  {
    flag: "--browser-url",
    property: "browserUrl",
    kind: "string",
    metavar: "url",
    description: "Use an explicit browser HTTP endpoint",
    startup: true,
    configProperty: "browserUrl",
  },
  {
    flag: "--host",
    property: "host",
    kind: "string",
    metavar: "host",
    description: "Use an explicit CDP host",
    startup: true,
    configProperty: "host",
  },
  {
    flag: "--port",
    property: "port",
    kind: "number",
    metavar: "port",
    description: "Use a fixed CDP port (launch or attach by mode)",
    startup: true,
    configProperty: "port",
  },
  {
    flag: "--chrome-path",
    property: "chromePath",
    kind: "string",
    metavar: "file",
    description: "Use a Chrome or Chromium executable",
    startup: true,
    configProperty: "chromePath",
  },
  {
    flag: "--channel",
    property: "channel",
    kind: "string",
    metavar: "name",
    description: "Select stable, beta, dev, canary, or chromium",
    startup: true,
    configProperty: "channel",
  },
  {
    flag: "--user-data-dir",
    property: "userDataDir",
    kind: "string",
    metavar: "directory",
    description: "Use a browser profile directory",
    startup: true,
    configProperty: "userDataDir",
  },
  {
    flag: "--read-only",
    property: "readOnly",
    kind: "boolean",
    description: "Disable mutating and sensitive browser tools",
    startup: true,
    configProperty: "readOnly",
  },
  {
    flag: "--allow-localhost",
    property: "allowLocalhost",
    kind: "boolean",
    description: "Permit loopback navigation",
    startup: true,
    configProperty: "allowLocalhost",
  },
  {
    flag: "--allow-private-hosts",
    property: "allowPrivateHosts",
    kind: "boolean",
    description: "Permit private, link-local, and loopback navigation",
    startup: true,
    configProperty: "allowPrivateHosts",
  },
  {
    flag: "--file-access-root",
    property: "fileAccessRoots",
    kind: "string",
    metavar: "path",
    description: "Add an upload/download root; repeatable",
    repeat: true,
    startup: true,
    configProperty: "fileAccessRoots",
  },
  {
    flag: "--timeout",
    property: "sessionTimeout",
    kind: "number",
    metavar: "ms",
    description: "Set browser startup and operation timeout",
    startup: true,
    configProperty: "timeout",
  },
];

interface LifecycleCommandSpec {
  readonly name: string;
  readonly synopsis: string;
  readonly usage?: string;
  readonly summary: string;
  readonly help: string;
  readonly group: "session" | "extensions" | "compatibility";
}

export const LIFECYCLE_COMMANDS = [
  {
    name: "start",
    synopsis: "start [startup options]",
    summary: "Start the session and browser",
    help: "Start the named session and its browser.",
    group: "session",
  },
  {
    name: "status",
    synopsis: "status [--session <name>] [--json]",
    summary: "Show session and browser state",
    help: "Show daemon, browser, and fixed session policy state.",
    group: "session",
  },
  {
    name: "stop",
    synopsis: "stop [--session <name>] [--json]",
    summary: "Stop the session",
    help: "Stop the session. Repeated calls succeed.",
    group: "session",
  },
  {
    name: "tools",
    synopsis: "tools [--json]",
    summary: "List browser tools",
    help: "List browser tools and their schemas.",
    group: "session",
  },
  {
    name: "call",
    synopsis: "call <tool> --input <json|-> [global options]",
    summary: "Call a tool with JSON input",
    help: "Call a tool. Use - to read one JSON object from stdin.",
    group: "session",
  },
  {
    name: "inspect",
    synopsis: "inspect <url>",
    usage: "inspect <url> [--max-tokens <n>] [--mode <mode>] [--full-page] [--include-hidden] [startup options]",
    summary: "Print a one-shot compressed page",
    help: "Launch or attach for one page read, then close the connection.",
    group: "compatibility",
  },
  {
    name: "mcp",
    synopsis: "mcp [startup options]",
    summary: "Run the MCP stdio adapter",
    help: "Run the optional MCP adapter over stdio.",
    group: "compatibility",
  },
  {
    name: "skills",
    synopsis: "skills [name] [--json]",
    summary: "List or read Agent Skills",
    help: "List discovered Agent Skills from .agents/skills, .tidesurf/skills, and installed agent plugins. Pass a skill name to print its full document.",
    group: "extensions",
  },
  {
    name: "plugins",
    synopsis: "plugins [--json]",
    summary: "List Agent Plugins",
    help: "List discovered Agent Plugins with their skills, MCP servers, and validation diagnostics.",
    group: "extensions",
  },
  {
    name: "help",
    synopsis: "help [command]",
    summary: "Show command help",
    help: "Show general or command-specific help.",
    group: "compatibility",
  },
] as const satisfies readonly LifecycleCommandSpec[];

export type LifecycleCommandName = typeof LIFECYCLE_COMMANDS[number]["name"];

export const CLI_EXIT_CODES = {
  success: { code: 0, meaning: "Success" },
  usage: { code: 2, meaning: "CLI usage or input parsing error" },
  browser: { code: 3, meaning: "Session or browser startup/connection error" },
  tool: { code: 4, meaning: "Tool execution failed" },
  protocol: { code: 5, meaning: "Daemon authentication, transport, or protocol error" },
} as const;

// Maps every first-party error name, including daemon-rehydrated wire
// errorType strings, to its documented exit code. Unknown names fall back to
// the tool exit code in errorExitCode.
export const CLI_ERROR_EXIT_CODES: Readonly<Record<string, number>> = {
  CliUsageError: CLI_EXIT_CODES.usage.code,
  ChromeLaunchError: CLI_EXIT_CODES.browser.code,
  CDPConnectionError: CLI_EXIT_CODES.browser.code,
  NavigationError: CLI_EXIT_CODES.browser.code,
  SessionStateError: CLI_EXIT_CODES.browser.code,
  SessionProtocolError: CLI_EXIT_CODES.protocol.code,
  TideSurfError: CLI_EXIT_CODES.tool.code,
  CDPTimeoutError: CLI_EXIT_CODES.tool.code,
  ElementNotFoundError: CLI_EXIT_CODES.tool.code,
  ValidationError: CLI_EXIT_CODES.tool.code,
  ReadOnlyError: CLI_EXIT_CODES.tool.code,
  ActionCommittedError: CLI_EXIT_CODES.tool.code,
};
