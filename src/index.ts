export { TideSurf } from "./tidesurf.js";
export { getToolDefinitions } from "./tools/definitions.js";
export { SurfingPage } from "./cdp/page.js";
export { TabManager } from "./cdp/tab-manager.js";
export { discoverBrowser } from "./cdp/launcher.js";
export { VERSION } from "./version.js";

export {
  TideSurfError,
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  ElementNotFoundError,
  NavigationError,
  ValidationError,
  ReadOnlyError,
} from "./errors.js";

export {
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
  validatePort,
  validateFilePath,
} from "./validation.js";

export { withTimeout } from "./cdp/timeout.js";
export { withRetry } from "./cdp/retry.js";
export { estimateTokens, pruneToFit } from "./parser/token-budget.js";

export type {
  OSNode,
  PageState,
  TideSurfOptions,
  TideSurfConnectOptions,
  GetStateOptions,
  ToolDefinition,
  ToolResult,
  NodeMap,
  CDPNode,
  ClassifyAction,
  ClassifyResult,
  SearchResult,
  ScreenshotOptions,
  DownloadResult,
  ScrollPosition,
} from "./types.js";

export type { TabInfo } from "./cdp/tab-manager.js";
