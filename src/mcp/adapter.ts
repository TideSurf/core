import type { ToolDefinition, ToolResult } from "../types.js";
import {
  formatToolData,
  getToolSpecs,
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
  structuredContent?: Record<string, unknown>;
}

export interface McpRequestHandlerExtra {
  readonly signal: AbortSignal;
}

export interface McpToolRegistration {
  remove(): void | Promise<void>;
}

export interface McpServerLike {
  registerTool(
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (
      input: Record<string, unknown>,
      extra: McpRequestHandlerExtra
    ) => Promise<McpCallResult>
  ): McpToolRegistration;
}

interface LaunchBrowserResult {
  alreadyRunning: boolean;
  headless: boolean;
  source: "launched" | "attached";
}

interface McpBrowserCoordinator {
  execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
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

  return text(formatToolData(result.data));
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
          return toolResult(
            spec,
            await coordinator.execute(spec.name, input)
          );
        } catch (error) {
          return caught(error);
        }
      }
    );
  }
}

interface ZodParsePayload {
  value: unknown;
  issues: unknown[];
}

interface ZodSchemaWithInternals {
  _zod: {
    run(payload: ZodParsePayload, ctx: unknown): unknown;
  };
}

export function createZodInputSchemaFactory(zod: {
  fromJSONSchema: (schema: unknown) => unknown;
}): McpInputSchemaFactory {
  // tools/call may omit "arguments" entirely; parse that as {} while keeping
  // the schema a plain zod object so the SDK still advertises its properties
  // in tools/list. Wrapper schemas (preprocess/default) lose that listing.
  return (inputSchema) => {
    const schema = zod.fromJSONSchema(inputSchema) as ZodSchemaWithInternals;
    const internals = schema._zod;
    const run = internals.run.bind(internals);
    internals.run = (payload, ctx) =>
      run(
        payload.value === undefined ? { ...payload, value: {} } : payload,
        ctx
      );
    return schema;
  };
}
