/**
 * CDP DOM node shape reconstructed from `DOMSnapshot.captureSnapshot`.
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

export type ClassifyAction = "KEEP" | "COLLAPSE" | "DISCARD";

export interface ClassifyResult {
  action: ClassifyAction;
  mappedTag?: string;
}

export interface OSNode {
  tag: string;
  id?: string;
  attributes: Record<string, string>;
  children: OSNode[];
  text?: string;
  visible?: boolean;
  state?: string[];
}

export type NodeMap = Map<string, number>;

/** Current page text and the action IDs represented by that text. */
export interface PageState {
  url: string;
  title: string;
  content: string;
  /** @deprecated Use `content` instead */
  xml: string;
  nodeMap: NodeMap;
}

/** Controls page capture, filtering, and token pruning. */
export interface ReadPageOptions {
  maxTokens?: number;
  /** Only include elements visible in the current viewport. Defaults to true. Set false for full page. */
  viewport?: boolean;
  /** Output mode: "full" (default), "minimal" (landmarks + summaries), "interactive" (only elements with IDs) */
  mode?: "full" | "minimal" | "interactive";
  /** Include the full DOM, including hidden elements, and disable viewport filtering. */
  includeHidden?: boolean;
}

/** @deprecated Use `ReadPageOptions`. */
export type GetStateOptions = ReadPageOptions;

/** Chromium release channel used for executable and profile discovery. */
export type ChromeChannel =
  | "stable"
  | "beta"
  | "dev"
  | "canary"
  | "chromium";

interface TideSurfSessionOptions {
  defaultViewport?: { width: number; height: number };
  timeout?: number;
  /** Reject navigation, interaction, evaluation, clipboard, filesystem, and tab mutation. */
  readOnly?: boolean;
  /** Allowed host filesystem roots. Omit for cwd + tmpdir; pass [] to disable file access. */
  fileAccessRoots?: string[];
  /** Allow navigation to localhost/loopback URLs. Intended for trusted local development. */
  allowLocalhost?: boolean;
  /** Allow navigation to private/link-local network URLs. Also allows localhost. */
  allowPrivateHosts?: boolean;
}

export interface TideSurfOptions extends TideSurfSessionOptions {
  headless?: boolean;
  chromePath?: string;
  /** Browser channel to auto-detect when chromePath is not provided. */
  channel?: ChromeChannel;
  port?: number;
  userDataDir?: string;
}

export interface TideSurfConnectOptions extends TideSurfSessionOptions {
  port?: number;
  host?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorType?: string;
  stack?: string;
}

export interface SearchResult {
  text: string;
  tag: string;
  index: number;
  elementId?: string;
}

export interface ScreenshotOptions {
  elementId?: string;
  fullPage?: boolean;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  totalBytes: number;
}

export interface ScrollPosition {
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
}

export type IDPrefixMap = Record<string, string>;
