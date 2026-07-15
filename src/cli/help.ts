import { getToolSpec, getToolSpecs, type ToolSpec } from "../tools/registry.js";
import { VERSION } from "../version.js";
import { GLOBAL_OPTIONS, LIFECYCLE_COMMANDS } from "./metadata.js";

function rows(entries: readonly (readonly [string, string])[]): string {
  const width = Math.max(...entries.map(([name]) => name.length));
  return entries.map(([name, description]) => `  ${name.padEnd(width)}  ${description}`).join("\n");
}

function toolRows(filter: (tool: ToolSpec) => boolean): string {
  return rows(
    getToolSpecs()
      .filter(filter)
      .map((tool) => [tool.name, tool.description] as const)
  );
}

function lifecycleRows(group: "session" | "compatibility"): string {
  return rows(
    LIFECYCLE_COMMANDS
      .filter((command) => command.group === group)
      .map((command) => [command.synopsis, command.summary] as const)
  );
}

function globalOptionRows(): string {
  return rows([
    ...GLOBAL_OPTIONS.map((option) => [
      `${option.flag}${option.kind === "boolean" ? "" : ` <${option.metavar ?? option.kind}>`}`,
      option.description,
    ] as const),
    ["-h, --help", "Show help"],
    ["-V, --version", "Show the version"],
  ]);
}

export function generalHelp(): string {
  return `TideSurf ${VERSION}
Stateful Chromium automation for agents

Usage:
  tidesurf [global options] <command> [arguments] [options]

Session commands:
${lifecycleRows("session")}

Read commands:
${toolRows((tool) => tool.readOnlyAllowed)}

Mutation and sensitive commands:
${toolRows((tool) => !tool.readOnlyAllowed)}

Compatibility commands:
${lifecycleRows("compatibility")}

Global options:
${globalOptionRows()}

The first tool call starts its named session and browser. Session startup policy
is immutable until stop.`;
}

function usageForTool(tool: ToolSpec): string {
  const positionals = tool.cli.positionals.map((item) =>
    item.required === false ? `[${item.name}]` : `<${item.name}>`
  );
  return `tidesurf ${tool.name}${positionals.length ? ` ${positionals.join(" ")}` : ""} [options]`;
}

function toolHelp(tool: ToolSpec): string {
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
  return `${tool.name}\n\n${tool.description}\n\nUsage:\n  ${usageForTool(tool)}${positionalLines}${optionLines}\n\nGlobal session and output options are also accepted.`;
}

export function commandHelp(command?: string): string | undefined {
  if (!command) return generalHelp();
  const tool = getToolSpec(command);
  if (tool) return toolHelp(tool);
  const lifecycle = LIFECYCLE_COMMANDS.find((item) => item.name === command);
  return lifecycle
    ? `Usage: tidesurf ${"usage" in lifecycle ? lifecycle.usage : lifecycle.synopsis}\n\n${lifecycle.help}`
    : undefined;
}
