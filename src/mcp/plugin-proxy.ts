import { mkdirSync } from "node:fs";
import type { LoadedPlugin } from "../extensions/plugins.js";
import { pluginDataDirectory } from "../extensions/plugins.js";
import type { McpCallResult, McpServerLike } from "./adapter.js";

interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: RemoteTool[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface PluginProxyFactories {
  readonly createClient: () => McpClientLike;
  readonly createStdioTransport: (params: {
    command: string;
    args: readonly string[];
    env: Record<string, string>;
    cwd: string;
    stderr: "inherit" | "pipe";
  }) => unknown;
  readonly createHttpTransport: (params: {
    url: string;
    headers?: Record<string, string>;
  }) => unknown;
  readonly createInputSchema: (schema: unknown) => unknown;
}

export interface PluginProxyOptions {
  readonly server: McpServerLike;
  readonly plugins: readonly LoadedPlugin[];
  readonly factories: PluginProxyFactories;
  readonly home?: string;
  readonly log?: (message: string) => void;
}

export interface ProxiedServerInfo {
  readonly plugin: string;
  readonly server: string;
  readonly tools: number;
}

export interface PluginProxy {
  readonly servers: readonly ProxiedServerInfo[];
  close(): Promise<void>;
}

const MAX_TOOL_NAME_BYTES = 64;

/** MCP tool names match ^[a-zA-Z0-9_-]{1,64}$; plugin names allow dots. */
function toolNamespace(pluginName: string, toolName: string): string {
  const sanitize = (value: string) => value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const full = `${sanitize(pluginName)}__${sanitize(toolName)}`;
  return full.length <= MAX_TOOL_NAME_BYTES
    ? full
    : full.slice(0, MAX_TOOL_NAME_BYTES);
}

function processEnvStrings(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function connectServer(
  options: PluginProxyOptions,
  plugin: LoadedPlugin,
  serverName: string,
  log: (message: string) => void
): Promise<{ client: McpClientLike; tools: RemoteTool[] } | undefined> {
  const spec = plugin.mcpServers.find((entry) => entry.name === serverName);
  if (!spec) return undefined;
  const { factories } = options;
  const client = factories.createClient();
  try {
    if (spec.type === "stdio") {
      const dataDir = pluginDataDirectory(
        options.home ?? process.env["HOME"] ?? "",
        plugin.name
      );
      mkdirSync(dataDir, { recursive: true });
      const transport = factories.createStdioTransport({
        command: spec.command!,
        args: spec.args ?? [],
        env: {
          ...processEnvStrings(),
          ...(spec.env ?? {}),
          PLUGIN_ROOT: plugin.directory,
          PLUGIN_DATA: dataDir,
        },
        cwd: spec.cwd ?? plugin.directory,
        stderr: "inherit",
      });
      await client.connect(transport);
    } else {
      const transport = factories.createHttpTransport({
        url: spec.url!,
        ...(spec.headers ? { headers: spec.headers } : {}),
      });
      await client.connect(transport);
    }
    const { tools } = await client.listTools();
    return { client, tools };
  } catch (error) {
    await client.close().catch(() => undefined);
    log(
      `plugin "${plugin.name}" server "${serverName}" failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

/**
 * Spawn/connect every MCP server declared by the loaded plugins and mirror
 * their tools into TideSurf's own MCP server under `<plugin>__<tool>` names.
 * Every failure is isolated to its server: one bad plugin never stops the
 * host server or sibling plugins.
 */
export async function proxyPluginMcpServers(
  options: PluginProxyOptions
): Promise<PluginProxy> {
  const log = options.log ?? (() => undefined);
  const clients: McpClientLike[] = [];
  const servers: ProxiedServerInfo[] = [];
  const takenNames = new Set<string>();

  for (const plugin of options.plugins) {
    for (const spec of plugin.mcpServers) {
      const connected = await connectServer(options, plugin, spec.name, log);
      if (!connected) continue;
      const { client, tools } = connected;
      clients.push(client);
      let registered = 0;
      for (const tool of tools) {
        const exposedName = toolNamespace(plugin.name, tool.name);
        if (takenNames.has(exposedName)) {
          log(
            `plugin "${plugin.name}" tool "${tool.name}" skipped: exposed name ${exposedName} is already taken`
          );
          continue;
        }
        takenNames.add(exposedName);
        const inputSchema =
          tool.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {} };
        let converted: unknown;
        try {
          converted = options.factories.createInputSchema(inputSchema);
        } catch (error) {
          log(
            `plugin "${plugin.name}" tool "${tool.name}" skipped: input schema conversion failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          continue;
        }
        options.server.registerTool(
          exposedName,
          {
            description:
              `[${plugin.name}] ${tool.description ?? `Tool ${tool.name} from plugin ${plugin.name}`}`,
            inputSchema: converted,
          },
          async (input) => {
            try {
              return (await client.callTool({
                name: tool.name,
                arguments: input,
              })) as McpCallResult;
            } catch (error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Plugin tool ${exposedName} failed: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  },
                ],
                isError: true,
              };
            }
          }
        );
        registered++;
      }
      servers.push({ plugin: plugin.name, server: spec.name, tools: registered });
      log(
        `plugin "${plugin.name}" server "${spec.name}": ${registered} tool(s) available`
      );
    }
  }

  return {
    servers,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}
