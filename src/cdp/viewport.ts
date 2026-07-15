import type { TideSurfOptions } from "../types.js";
import type { CDPConnection } from "./connection.js";
import { withTimeout } from "./timeout.js";

export async function applyViewport(
  conn: CDPConnection,
  viewport: NonNullable<TideSurfOptions["defaultViewport"]>,
  timeout?: number
): Promise<void> {
  await withTimeout(
    conn.Emulation.setDeviceMetricsOverride({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }),
    timeout ?? 5_000,
    "applyViewport"
  );
}
