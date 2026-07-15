export { TideSurf } from "./tidesurf.js";
export { getToolDefinitions } from "./tools/registry.js";
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
  ActionCommittedError,
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
  ReadPageOptions,
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
  ChromeChannel,
} from "./types.js";

export type { TabInfo } from "./cdp/tab-manager.js";
