import { resolveChromeExecutable } from "../../src/cdp/launcher.js";

export function canResolveBrowser(): boolean {
  try {
    resolveChromeExecutable();
    return true;
  } catch (error) {
    if (process.env["CHROME_PATH"]) throw error;
    return false;
  }
}
