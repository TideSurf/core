import type { TideSurf } from "../tidesurf.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { ActionCommittedError } from "../errors.js";
import {
  validateElementId,
  validateExpression,
  validateFilePath,
  validatePositiveInteger,
  validatePositiveNumber,
  validateSearchQuery,
  validateSelector,
  validateUrl,
} from "../validation.js";

type ToolOutputKind = "text" | "json" | "image";
type CliValueKind = "string" | "number" | "boolean";

interface ToolCliPositional {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly resolvePath?: boolean;
}

interface ToolCliOption {
  readonly property: string;
  readonly flag: string;
  readonly kind: CliValueKind;
  readonly description: string;
  readonly input?: false | { readonly property: string; readonly value: unknown };
  readonly conflictsWith?: readonly string[];
  readonly resolvePath?: boolean;
  readonly metavar?: string;
}

interface ToolCliSpec {
  readonly positionals: readonly ToolCliPositional[];
  readonly options: readonly ToolCliOption[];
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolDefinition["input_schema"];
  readonly readOnlyAllowed: boolean;
  readonly outputKind: ToolOutputKind;
  readonly cli: ToolCliSpec;
  readonly validate?: (
    input: Record<string, unknown>,
    instance?: Partial<Pick<TideSurf, "getUrlValidationOptions">>
  ) => void;
  readonly handler: (
    instance: TideSurf,
    input: Record<string, unknown>
  ) => Promise<unknown>;
}

interface ToolInput {
  name: string;
  input: Record<string, unknown>;
}

export type ToolExecutor = (tool: ToolInput) => Promise<ToolResult>;

type ToolDispatch = (
  tool: ToolSpec,
  input: Record<string, unknown>
) => Promise<ToolResult>;

const property = (
  type: "string" | "number" | "boolean",
  description: string,
  values?: readonly string[]
): Record<string, unknown> => ({
  type,
  ...(values ? { enum: [...values] } : {}),
  description,
});

const schema = (
  properties: Record<string, Record<string, unknown>>,
  required?: readonly string[]
): ToolDefinition["input_schema"] => ({
  type: "object",
  properties,
  ...(required && required.length > 0 ? { required: [...required] } : {}),
});

const positional = (
  name: string,
  description: string,
  required = true,
  resolvePath = false
): ToolCliPositional => ({ name, description, required, resolvePath });

const option = (
  propertyName: string,
  flag: string,
  kind: CliValueKind,
  description: string,
  metadata?: Pick<
    ToolCliOption,
    "input" | "conflictsWith" | "resolvePath" | "metavar"
  >
): ToolCliOption => ({ property: propertyName, flag, kind, description, ...metadata });

const cli = (
  positionals: readonly ToolCliPositional[] = [],
  options: readonly ToolCliOption[] = []
): ToolCliSpec => ({ positionals, options });

function stringInput(input: Record<string, unknown>, name: string): string {
  return input[name] as string;
}

function optionalString(
  input: Record<string, unknown>,
  name: string
): string | undefined {
  return input[name] as string | undefined;
}

function optionalNumber(
  input: Record<string, unknown>,
  name: string
): number | undefined {
  return input[name] as number | undefined;
}

function optionalBoolean(
  input: Record<string, unknown>,
  name: string
): boolean | undefined {
  return input[name] as boolean | undefined;
}

function validateUrlInput(
  input: Record<string, unknown>,
  instance?: Partial<Pick<TideSurf, "getUrlValidationOptions">>,
  optional = false
): void {
  const url = optionalString(input, "url");
  if (url === undefined && optional) return;
  const options = instance?.getUrlValidationOptions?.() ?? {};
  validateUrl(url ?? "", options);
}

function validateId(input: Record<string, unknown>): void {
  validateElementId(stringInput(input, "id"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pageAfterAction(
  instance: TideSurf,
  confirmation: string
): Promise<string> {
  try {
    return `${confirmation} Page state:\n\n${(await instance.readPage()).content}`;
  } catch (error) {
    return `${confirmation} The action completed, but the updated page could not be read: ${errorMessage(error)}. Run get_state before the next action.`;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const TOOL_REGISTRY: readonly ToolSpec[] = deepFreeze([
  {
    name: "get_state",
    description:
      "Get the current page as compressed text, including its URL, title, and current action IDs.",
    inputSchema: schema({
      maxTokens: property(
        "number",
        "Approximate token target. Lower-priority content is pruned first."
      ),
      viewport: property(
        "boolean",
        "Only include elements visible in the current viewport."
      ),
      mode: property("string", "Output detail level.", [
        "full",
        "minimal",
        "interactive",
      ]),
      includeHidden: property(
        "boolean",
        "Include hidden elements and disable viewport filtering."
      ),
    }),
    readOnlyAllowed: true,
    outputKind: "text",
    cli: cli([], [
      option("maxTokens", "--max-tokens", "number", "Token budget"),
      option("viewport", "--viewport", "boolean", "Limit output to the viewport"),
      option("mode", "--mode", "string", "Output mode", {
        metavar: "full|minimal|interactive",
      }),
      option(
        "includeHidden",
        "--include-hidden",
        "boolean",
        "Include hidden elements"
      ),
      option("fullPage", "--full-page", "boolean", "Disable viewport filtering", {
        input: { property: "viewport", value: false },
        conflictsWith: ["viewport"],
      }),
    ]),
    validate: (input) => {
      const maxTokens = optionalNumber(input, "maxTokens");
      if (maxTokens !== undefined) validatePositiveInteger(maxTokens, "maxTokens");
    },
    handler: async (instance, input) => {
      const state = await instance.readPage({
        maxTokens: optionalNumber(input, "maxTokens"),
        viewport: optionalBoolean(input, "viewport"),
        mode: optionalString(input, "mode") as
          | "full"
          | "minimal"
          | "interactive"
          | undefined,
        includeHidden: optionalBoolean(input, "includeHidden"),
      });
      return state.content;
    },
  },
  {
    name: "navigate",
    description: "Navigate to a URL and return the new page state.",
    inputSchema: schema(
      { url: property("string", "URL to open") },
      ["url"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([positional("url", "URL to open")]),
    validate: (input, instance) => validateUrlInput(input, instance),
    handler: async (instance, input) => {
      await instance.navigate(stringInput(input, "url"));
      return pageAfterAction(instance, "Navigation completed.");
    },
  },
  {
    name: "click",
    description:
      "Click an interactive element by its ID. Call get_state first to obtain IDs.",
    inputSchema: schema(
      { id: property("string", "Element ID from get_state, such as B1") },
      ["id"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([positional("id", "Element ID")]),
    validate: (input) => validateId(input),
    handler: async (instance, input) => {
      const id = stringInput(input, "id");
      await instance.getPage().click(id);
      return pageAfterAction(instance, `Clicked ${id}.`);
    },
  },
  {
    name: "type",
    description: "Type text into an input, optionally clearing it first.",
    inputSchema: schema(
      {
        id: property("string", "Input ID from get_state, such as I1"),
        text: property("string", "Text to type"),
        clear: property("boolean", "Clear the field before typing"),
      },
      ["id", "text"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli(
      [positional("id", "Input ID"), positional("text", "Text to type")],
      [option("clear", "--clear", "boolean", "Clear the field first")]
    ),
    validate: (input) => validateId(input),
    handler: async (instance, input) => {
      const id = stringInput(input, "id");
      const clear = optionalBoolean(input, "clear") ?? false;
      await instance.getPage().type(id, stringInput(input, "text"), clear);
      return `Typed into ${id}${clear ? " after clearing the field" : ""}.`;
    },
  },
  {
    name: "select",
    description: "Select an option by select ID and option value.",
    inputSchema: schema(
      {
        id: property("string", "Select ID from get_state, such as S1"),
        value: property("string", "Option value"),
      },
      ["id", "value"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([
      positional("id", "Select ID"),
      positional("value", "Option value"),
    ]),
    validate: (input) => validateId(input),
    handler: async (instance, input) => {
      const id = stringInput(input, "id");
      await instance.getPage().select(id, stringInput(input, "value"));
      return `Selected an option in ${id}.`;
    },
  },
  {
    name: "scroll",
    description: "Scroll the page up or down and return the new page state.",
    inputSchema: schema(
      {
        direction: property("string", "Scroll direction", ["up", "down"]),
        amount: property("number", "Pixels to scroll"),
      },
      ["direction"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli(
      [positional("direction", "up or down")],
      [option("amount", "--amount", "number", "Pixels to scroll")]
    ),
    validate: (input) => {
      const amount = optionalNumber(input, "amount");
      if (amount !== undefined) validatePositiveNumber(amount, "amount");
    },
    handler: async (instance, input) => {
      const direction = stringInput(input, "direction") as "up" | "down";
      await instance.getPage().scroll(direction, optionalNumber(input, "amount"));
      return pageAfterAction(instance, `Scrolled ${direction}.`);
    },
  },
  {
    name: "extract",
    description: "Extract text with a CSS selector.",
    inputSchema: schema(
      { selector: property("string", "CSS selector") },
      ["selector"]
    ),
    readOnlyAllowed: true,
    outputKind: "text",
    cli: cli([positional("selector", "CSS selector")]),
    validate: (input) => validateSelector(stringInput(input, "selector")),
    handler: (instance, input) =>
      instance.getPage().extract(stringInput(input, "selector")),
  },
  {
    name: "evaluate",
    description: "Execute arbitrary JavaScript in the page and return its result.",
    inputSchema: schema(
      { expression: property("string", "JavaScript expression") },
      ["expression"]
    ),
    readOnlyAllowed: false,
    outputKind: "json",
    cli: cli([positional("expression", "JavaScript expression")]),
    validate: (input) => validateExpression(stringInput(input, "expression")),
    handler: (instance, input) =>
      instance.getPage().evaluate(stringInput(input, "expression")),
  },
  {
    name: "list_tabs",
    description: "List open tabs with their IDs, URLs, and titles.",
    inputSchema: schema({}),
    readOnlyAllowed: true,
    outputKind: "json",
    cli: cli(),
    handler: (instance) => instance.listTabs(),
  },
  {
    name: "new_tab",
    description: "Open a tab, optionally at a URL.",
    inputSchema: schema({ url: property("string", "URL to open") }),
    readOnlyAllowed: false,
    outputKind: "json",
    cli: cli([positional("url", "URL to open", false)]),
    validate: (input, instance) => validateUrlInput(input, instance, true),
    handler: (instance, input) => instance.newTab(optionalString(input, "url")),
  },
  {
    name: "switch_tab",
    description: "Switch to a tab by ID and return its page state.",
    inputSchema: schema(
      { tabId: property("string", "Tab ID from list_tabs") },
      ["tabId"]
    ),
    readOnlyAllowed: true,
    outputKind: "text",
    cli: cli([positional("tabId", "Tab ID")]),
    handler: async (instance, input) => {
      const tabId = stringInput(input, "tabId");
      await instance.switchTab(tabId);
      return pageAfterAction(instance, `Switched to tab ${tabId}.`);
    },
  },
  {
    name: "close_tab",
    description: "Close a tab by ID and list the remaining tabs.",
    inputSchema: schema(
      { tabId: property("string", "Tab ID from list_tabs") },
      ["tabId"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([positional("tabId", "Tab ID")]),
    handler: async (instance, input) => {
      const tabId = stringInput(input, "tabId");
      await instance.closeTab(tabId);
      try {
        const tabs = await instance.listTabs();
        return `Closed tab ${tabId}. Remaining tabs:\n${JSON.stringify(tabs, null, 2)}`;
      } catch (error) {
        return `Closed tab ${tabId}. The tab list could not be refreshed: ${errorMessage(error)}. Run list_tabs before the next tab action.`;
      }
    },
  },
  {
    name: "search",
    description:
      "Search page text and return matching snippets with nearby element IDs.",
    inputSchema: schema(
      {
        query: property("string", "Case-insensitive search text"),
        maxResults: property("number", "Maximum result count"),
      },
      ["query"]
    ),
    readOnlyAllowed: true,
    outputKind: "json",
    cli: cli(
      [positional("query", "Search text")],
      [option("maxResults", "--max-results", "number", "Maximum results")]
    ),
    validate: (input) => {
      validateSearchQuery(stringInput(input, "query"));
      const maxResults = optionalNumber(input, "maxResults");
      if (maxResults !== undefined) {
        validatePositiveInteger(maxResults, "maxResults");
      }
    },
    handler: (instance, input) =>
      instance
        .getPage()
        .search(
          stringInput(input, "query"),
          optionalNumber(input, "maxResults")
        ),
  },
  {
    name: "screenshot",
    description: "Capture the viewport, full page, or one element as PNG.",
    inputSchema: schema({
      elementId: property("string", "Element ID to capture"),
      fullPage: property("boolean", "Capture the full scrollable page"),
    }),
    readOnlyAllowed: true,
    outputKind: "image",
    cli: cli([], [
      option("elementId", "--element-id", "string", "Element ID to capture"),
      option("fullPage", "--full-page", "boolean", "Capture the full page"),
      option("screenshotOutput", "--output", "string", "Write PNG to a file or stdout", {
        input: false,
        metavar: "file|-",
      }),
    ]),
    validate: (input) => {
      const id = optionalString(input, "elementId");
      if (id !== undefined) validateElementId(id);
      if (id !== undefined && optionalBoolean(input, "fullPage")) {
        throw new Error("screenshot cannot target an element and fullPage at the same time");
      }
    },
    handler: (instance, input) =>
      instance.getPage().screenshot({
        elementId: optionalString(input, "elementId"),
        fullPage: optionalBoolean(input, "fullPage"),
      }),
  },
  {
    name: "upload",
    description: "Upload a local file through a file input.",
    inputSchema: schema(
      {
        id: property("string", "File input ID"),
        filePath: property("string", "Local file path"),
      },
      ["id", "filePath"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([
      positional("id", "File input ID"),
      positional("filePath", "Local file path", true, true),
    ]),
    validate: (input) => {
      validateId(input);
      validateFilePath(stringInput(input, "filePath"));
    },
    handler: async (instance, input) => {
      const id = stringInput(input, "id");
      await instance.getPage().upload(id, [stringInput(input, "filePath")]);
      return `Uploaded a file to ${id}.`;
    },
  },
  {
    name: "clipboard_read",
    description: "Read text from the system clipboard.",
    inputSchema: schema({}),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli(),
    handler: (instance) => instance.getPage().clipboardRead(),
  },
  {
    name: "clipboard_write",
    description: "Write text to the system clipboard.",
    inputSchema: schema(
      { text: property("string", "Text to write") },
      ["text"]
    ),
    readOnlyAllowed: false,
    outputKind: "text",
    cli: cli([positional("text", "Text to write")]),
    handler: async (instance, input) => {
      await instance.getPage().clipboardWrite(stringInput(input, "text"));
      return "Clipboard updated.";
    },
  },
  {
    name: "download",
    description: "Click an element and wait for its file download.",
    inputSchema: schema(
      {
        id: property("string", "Download link or button ID"),
        downloadDir: property("string", "Destination directory"),
        timeout: property("number", "Wait timeout in milliseconds"),
      },
      ["id"]
    ),
    readOnlyAllowed: false,
    outputKind: "json",
    cli: cli(
      [positional("id", "Download link or button ID")],
      [
        option(
          "downloadDir",
          "--download-dir",
          "string",
          "Destination directory",
          { resolvePath: true }
        ),
        option("timeout", "--timeout", "number", "Wait timeout"),
      ]
    ),
    validate: (input) => {
      validateId(input);
      const dir = optionalString(input, "downloadDir");
      if (dir !== undefined) validateFilePath(dir);
      const timeout = optionalNumber(input, "timeout");
      if (timeout !== undefined) validatePositiveInteger(timeout, "timeout");
    },
    handler: (instance, input) =>
      instance.getPage().download(stringInput(input, "id"), {
        downloadDir: optionalString(input, "downloadDir"),
        timeout: optionalNumber(input, "timeout"),
      }),
  },
] satisfies ToolSpec[]);

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function getToolSpec(name: string): ToolSpec | undefined {
  return TOOL_BY_NAME.get(name);
}

export function getToolSpecs(options?: {
  readOnly?: boolean;
}): readonly ToolSpec[] {
  return options?.readOnly
    ? TOOL_REGISTRY.filter((tool) => tool.readOnlyAllowed)
    : TOOL_REGISTRY;
}

export function getToolNames(): string[] {
  return TOOL_REGISTRY.map((tool) => tool.name);
}

export function unknownToolMessage(name: string): string {
  return `Unknown tool: ${name}. Available tools: ${getToolNames().join(", ")}.`;
}

export function readOnlyToolMessage(tool: Pick<ToolSpec, "name">): string {
  return `Tool "${tool.name}" is disabled in read-only mode`;
}

export function formatToolData(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "OK";
  return JSON.stringify(value, null, 2) ?? String(value);
}

export function getToolDefinitions(options?: {
  readOnly?: boolean;
}): ToolDefinition[] {
  return getToolSpecs(options).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: structuredClone(tool.inputSchema),
  }));
}

function fieldLabel(name: string): string {
  if (name === "url") return "URL";
  if (name === "id") return "Element ID";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function validateToolInput(
  tool: ToolSpec,
  input: Record<string, unknown>,
  instance?: Partial<Pick<TideSurf, "getUrlValidationOptions">>
): void {
  const required = tool.inputSchema.required ?? [];
  for (const name of required) {
    if (input[name] === undefined) {
      throw new Error(`${fieldLabel(name)} is required`);
    }
  }

  for (const [name, rawProperty] of Object.entries(
    tool.inputSchema.properties
  )) {
    const value = input[name];
    if (value === undefined) continue;
    const definition = rawProperty as {
      type?: string;
      enum?: readonly unknown[];
    };

    if (definition.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${fieldLabel(name)} must be a finite number`);
      }
    } else if (typeof value !== definition.type) {
      throw new Error(`${fieldLabel(name)} must be a ${definition.type}`);
    }

    if (definition.enum && !definition.enum.includes(value)) {
      throw new Error(
        `${fieldLabel(name)} must be one of: ${definition.enum.join(", ")}`
      );
    }
  }
  tool.validate?.(input, instance);
}

function failure(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const stack =
    process.env.NODE_ENV === "development" && error instanceof Error
      ? error.stack
      : undefined;

  return { success: false, error: message, errorType, stack };
}

export function createToolExecutor(instance: TideSurf): ToolExecutor {
  const readOnly = instance.isReadOnly();
  return (request) =>
    dispatchTool(request, readOnly, (tool, input) =>
      executeToolSpec(instance, tool, input)
    );
}

export function dispatchTool(
  request: ToolInput,
  readOnly: boolean,
  dispatch: ToolDispatch
): Promise<ToolResult> {
  const tool = getToolSpec(request.name);
  if (!tool) {
    return Promise.resolve({
      success: false,
      error: unknownToolMessage(request.name),
    });
  }
  if (readOnly && !tool.readOnlyAllowed) {
    return Promise.resolve({
      success: false,
      error: readOnlyToolMessage(tool),
    });
  }
  return dispatch(tool, request.input);
}

export async function executeToolSpec(
  instance: TideSurf,
  tool: ToolSpec,
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Tool input must be an object");
    }
    validateToolInput(tool, input, instance);
    return { success: true, data: await tool.handler(instance, input) };
  } catch (error) {
    if (error instanceof ActionCommittedError) {
      return { success: true, data: error.message };
    }
    return failure(error);
  }
}
