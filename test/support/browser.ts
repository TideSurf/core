import { resolveChromeExecutable } from "../../src/cdp/launcher.js";
import { TideSurf } from "../../src/tidesurf.js";

export function canResolveBrowser(): boolean {
  try {
    resolveChromeExecutable();
    return true;
  } catch (error) {
    if (process.env["CHROME_PATH"]) throw error;
    return false;
  }
}

export async function canLaunchBrowser(): Promise<boolean> {
  if (!canResolveBrowser()) return false;
  const browser = await TideSurf.launch({ headless: true });
  await browser.close();
  return true;
}
