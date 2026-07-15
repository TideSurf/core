import type { ToolDefinition, ToolResult } from "../types.js";
import {
  getToolSpecs,
  type ToolExecutor,
  type ToolSpec,
} from "../tools/registry.js";

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpImageContent {
  type: "image";
  data: string;
  mimeType: "image/png";
}

export interface McpCallResult {
  content: Array<McpTextContent | McpImageContent>;
  isError?: boolean;
}

export interface McpServerLike {
  registerTool(
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: Record<string, unknown>) => Promise<McpCallResult>
  ): unknown;
}

interface LaunchBrowserResult {
  alreadyRunning: boolean;
  headless: boolean;
  source: "launched" | "attached";
}

/**
 * Owns browser startup and executor reuse for an MCP server. The adapter stays
 * independent of the optional MCP SDK and of the CLI session implementation.
 */
interface McpBrowserCoordinator {
  executor(): Promise<ToolExecutor>;
  launchBrowser(options: { headless?: boolean }): Promise<LaunchBrowserResult>;
}

type McpInputSchemaFactory = (
  schema: ToolDefinition["input_schema"]
) => unknown;

interface RegisterMcpToolsOptions {
  server: McpServerLike;
  coordinator: McpBrowserCoordinator;
  createInputSchema: McpInputSchemaFactory;
  readOnly?: boolean;
}

const LAUNCH_BROWSER_SCHEMA: ToolDefinition["input_schema"] = {
  type: "object",
  properties: {
    headless: {
      type: "boolean",
      description: "Run without a visible browser window",
    },
  },
};

function text(value: string, isError = false): McpCallResult {
  return {
    content: [{ type: "text", text: value }],
    ...(isError ? { isError: true } : {}),
  };
}

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "OK";
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function toolResult(spec: ToolSpec, result: ToolResult): McpCallResult {
  if (!result.success) {
    return text(result.error ?? "Tool failed", true);
  }

  if (spec.outputKind === "image") {
    if (typeof result.data !== "string") {
      return text("Screenshot did not return PNG data", true);
    }
    return {
      content: [
        { type: "image", data: result.data, mimeType: "image/png" },
      ],
    };
  }

  return text(printable(result.data));
}

function caught(error: unknown): McpCallResult {
  return text(error instanceof Error ? error.message : String(error), true);
}

export function registerMcpTools({
  server,
  coordinator,
  createInputSchema,
  readOnly = false,
}: RegisterMcpToolsOptions): void {
  server.registerTool(
    "launch_browser",
    {
      description:
        "Start the browser explicitly. Other tools start it automatically when needed.",
      inputSchema: createInputSchema(LAUNCH_BROWSER_SCHEMA),
    },
    async (input) => {
      try {
        const result = await coordinator.launchBrowser({
          headless: input["headless"] as boolean | undefined,
        });
        return text(
          result.alreadyRunning
            ? "Browser is already running."
            : result.source === "attached"
              ? "Browser attached."
              : `Browser launched (${result.headless ? "headless" : "headful"}).`
        );
      } catch (error) {
        return caught(error);
      }
    }
  );

  for (const spec of getToolSpecs({ readOnly })) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: createInputSchema(spec.inputSchema),
      },
      async (input) => {
        try {
          const execute = await coordinator.executor();
          return toolResult(
            spec,
            await execute({ name: spec.name, input })
          );
        } catch (error) {
          return caught(error);
        }
      }
    );
  }
}

/** Build the adapter callback from Zod 4 without importing the optional package. */
export function createZodInputSchemaFactory(zod: {
  fromJSONSchema: (schema: unknown) => unknown;
}): McpInputSchemaFactory {
  return (inputSchema) => zod.fromJSONSchema(inputSchema);
}
