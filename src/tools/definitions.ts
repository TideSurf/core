import type { ToolDefinition } from "../types.js";

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "get_state",
      description:
        "Get the current page state as compressed XML. Returns the page URL, title, and a token-efficient XML representation of the visible DOM. Interactive elements have IDs (L=link, B=button, I=input, S=select) for use with other tools.",
      input_schema: {
        type: "object",
        properties: {
          maxTokens: {
            type: "number",
            description:
              "Optional token budget. If set, the output will be pruned to fit within this limit, prioritizing interactive and visible elements.",
          },
        },
      },
    },
    {
      name: "navigate",
      description: "Navigate the browser to a URL.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" },
        },
        required: ["url"],
      },
    },
    {
      name: "click",
      description:
        "Click an interactive element by its ID (e.g. B1 for a button, L3 for a link). Call get_state first to see available elements.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The element ID from get_state (e.g. B1, L3)",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "type",
      description:
        "Type text into an input field by its ID. Optionally clear the field first.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The input element ID from get_state (e.g. I1)",
          },
          text: { type: "string", description: "The text to type" },
          clear: {
            type: "boolean",
            description: "Clear the field before typing (default: false)",
          },
        },
        required: ["id", "text"],
      },
    },
    {
      name: "select",
      description: "Select an option in a dropdown by its ID and value.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The select element ID from get_state (e.g. S1)",
          },
          value: {
            type: "string",
            description: "The value of the option to select",
          },
        },
        required: ["id", "value"],
      },
    },
    {
      name: "scroll",
      description: "Scroll the page up or down.",
      input_schema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Scroll direction",
          },
          amount: {
            type: "number",
            description: "Pixels to scroll (default: 500)",
          },
        },
        required: ["direction"],
      },
    },
    {
      name: "extract",
      description:
        "Extract text content from the page using a CSS selector.",
      input_schema: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to extract text from",
          },
        },
        required: ["selector"],
      },
    },
    {
      name: "evaluate",
      description:
        "Execute JavaScript in the page context and return the result. Use for advanced interactions not covered by other tools.",
      input_schema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "JavaScript expression to evaluate",
          },
        },
        required: ["expression"],
      },
    },
    {
      name: "list_tabs",
      description: "List all open browser tabs with their IDs, URLs, and titles.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "new_tab",
      description: "Open a new browser tab, optionally navigating to a URL.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Optional URL to navigate to in the new tab",
          },
        },
      },
    },
    {
      name: "switch_tab",
      description: "Switch to a different browser tab by its ID.",
      input_schema: {
        type: "object",
        properties: {
          tabId: {
            type: "string",
            description: "The tab ID to switch to (from list_tabs)",
          },
        },
        required: ["tabId"],
      },
    },
    {
      name: "close_tab",
      description: "Close a browser tab by its ID.",
      input_schema: {
        type: "object",
        properties: {
          tabId: {
            type: "string",
            description: "The tab ID to close (from list_tabs)",
          },
        },
        required: ["tabId"],
      },
    },
  ];
}
