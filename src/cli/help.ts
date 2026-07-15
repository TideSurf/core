import { getToolSpecByCommand, getToolSpecs, type ToolSpec } from "../tools/registry.js";
import { VERSION } from "../version.js";

const SESSION_COMMANDS = [
  ["start", "Start the session and browser"],
  ["status", "Show session and browser state"],
  ["stop", "Stop the session"],
  ["tools", "List canonical tools"],
  ["call <tool> --input <json|->", "Call a tool with JSON input"],
] as const;

const COMPATIBILITY_COMMANDS = [
  ["inspect <url>", "Print a one-shot compressed page"],
  ["mcp", "Run the MCP stdio adapter"],
  ["help [command]", "Show command help"],
] as const;

function rows(entries: readonly (readonly [string, string])[]): string {
  const width = Math.max(...entries.map(([name]) => name.length));
  return entries.map(([name, description]) => `  ${name.padEnd(width)}  ${description}`).join("\n");
}

function toolRows(filter: (tool: ToolSpec) => boolean): string {
  return rows(
    getToolSpecs()
      .filter(filter)
      .map((tool) => [tool.cli.command, tool.description] as const)
  );
}

export function generalHelp(): string {
  return `TideSurf ${VERSION}
Stateful Chromium automation for agents

Usage:
  tidesurf [global options] <command> [arguments] [options]

Session commands:
${rows(SESSION_COMMANDS)}

Read commands:
${toolRows((tool) => tool.readOnlyAllowed)}

Mutation and sensitive commands:
${toolRows((tool) => !tool.readOnlyAllowed)}

Compatibility commands:
${rows(COMPATIBILITY_COMMANDS)}

Global options:
  --session <name>             Session name (default: default)
  --json                       Emit the ToolResult JSON shape
  --quiet                      Suppress MCP status output
  --headful                    Show the managed browser window
  --auto-connect               Attach locally, then launch if unavailable
  --connect-only               Attach without launching a browser
  --browser-url <url>          Explicit browser HTTP endpoint
  --host <host>                Explicit CDP host
  --port <port>                Explicit CDP port
  --chrome-path <file>         Explicit Chrome or Chromium executable
  --channel <name>             stable, beta, dev, canary, or chromium
  --user-data-dir <directory>  Browser profile directory
  --read-only                  Disable mutating and sensitive browser tools
  --allow-localhost            Permit loopback navigation
  --allow-private-hosts        Permit private-network navigation
  --file-access-root <path>    Add an upload/download root; repeatable
  --timeout <ms>               Browser operation timeout
  -h, --help                   Show help
  -V, --version                Show the version

The first tool call starts its named session and browser. Session startup policy
is immutable until stop. Tool commands also accept their MCP underscore names.`;
}

function usageForTool(tool: ToolSpec): string {
  const positionals = tool.cli.positionals.map((item) =>
    item.required === false ? `[${item.name}]` : `<${item.name}>`
  );
  return `tidesurf ${tool.cli.command}${positionals.length ? ` ${positionals.join(" ")}` : ""} [options]`;
}

function toolHelp(tool: ToolSpec): string {
  const aliases = tool.cli.aliases.length
    ? `\nAlias: ${tool.cli.aliases.join(", ")}`
    : "";
  const positionalLines = tool.cli.positionals.length
    ? `\n\nArguments:\n${rows(tool.cli.positionals.map((item) => [
      item.required === false ? `[${item.name}]` : `<${item.name}>`,
      item.description,
    ] as const))}`
    : "";
  const commandOptions: Array<readonly [string, string]> = tool.cli.options.map((item) => [
      `${item.flag}${item.kind === "boolean" ? "" : ` <${item.metavar ?? item.kind}>`}`,
      item.description,
    ] as const);
  const optionLines = commandOptions.length
    ? `\n\nOptions:\n${rows(commandOptions)}`
    : "";
  return `${tool.cli.command}\n\n${tool.description}${aliases}\n\nUsage:\n  ${usageForTool(tool)}${positionalLines}${optionLines}\n\nGlobal session and output options are also accepted.`;
}

const COMMAND_HELP: Record<string, string> = {
  start: "Usage: tidesurf start [startup options]\n\nStart the named session and its browser.",
  status: "Usage: tidesurf status [--session <name>] [--json]\n\nShow daemon, browser, and immutable session policy state.",
  stop: "Usage: tidesurf stop [--session <name>] [--json]\n\nStop the session. Repeated calls succeed.",
  tools: "Usage: tidesurf tools [--json]\n\nList the 18 canonical tools and their schemas.",
  call: "Usage: tidesurf call <tool> --input <json|-> [global options]\n\nCall a canonical tool. Use - to read one JSON object from stdin.",
  inspect: "Usage: tidesurf inspect <url> [--max-tokens <n>] [--mode <mode>] [--full-page] [--include-hidden] [startup options]\n\nLaunch or attach for one page read, then close the connection.",
  mcp: "Usage: tidesurf mcp [startup options]\n\nRun the optional MCP adapter over stdio.",
  help: "Usage: tidesurf help [command]\n\nShow general or command-specific help.",
};

export function commandHelp(command?: string): string | undefined {
  if (!command) return generalHelp();
  const tool = getToolSpecByCommand(command);
  return tool ? toolHelp(tool) : COMMAND_HELP[command];
}
