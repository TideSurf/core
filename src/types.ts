/**
 * CDP DOM.Node subset — what we get from DOM.getDocument({depth: -1})
 */
export interface CDPNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  childNodeCount?: number;
  children?: CDPNode[];
  attributes?: string[];
  contentDocument?: CDPNode;
  shadowRoots?: CDPNode[];
  frameId?: string;
}

/**
 * Classification action for a DOM element
 */
export type ClassifyAction = "KEEP" | "COLLAPSE" | "DISCARD";

export interface ClassifyResult {
  action: ClassifyAction;
  mappedTag?: string;
}

/**
 * Compressed DOM node produced by the parser
 */
export interface OSNode {
  tag: string;
  id?: string;
  attributes: Record<string, string>;
  children: OSNode[];
  text?: string;
  visible?: boolean;
}

/**
 * Maps assigned IDs back to CDP backendNodeIds for interaction
 */
export type NodeMap = Map<string, number>;

/**
 * Full page state returned by getState()
 */
export interface PageState {
  url: string;
  title: string;
  xml: string;
  nodeMap: NodeMap;
}

/**
 * Options for getState()
 */
export interface GetStateOptions {
  maxTokens?: number;
}

/**
 * Options for launching TideSurf
 */
export interface TideSurfOptions {
  headless?: boolean;
  chromePath?: string;
  port?: number;
  userDataDir?: string;
  defaultViewport?: { width: number; height: number };
  timeout?: number;
}

/**
 * Options for connecting to an already-running Chrome instance
 */
export interface TideSurfConnectOptions {
  /** CDP port to connect to (default: 9222) */
  port?: number;
  /** CDP host to connect to (default: localhost) */
  host?: string;
  /** Connect timeout in ms */
  timeout?: number;
}

/**
 * Tool definition compatible with Claude/OpenAI function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Prefix map for ID assignment
 */
export type IDPrefixMap = Record<string, string>;
