import { describe, expect, it } from "vitest";
import { buildChromeArgs } from "../../src/cdp/launcher.js";

describe("buildChromeArgs", () => {
  it("keeps the Chrome sandbox in ordinary CI environments", () => {
    const args = buildChromeArgs(
      {
        headless: true,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      { CI: "true" },
      1000
    );

    expect(args).not.toContain("--no-sandbox");
    expect(args).not.toContain("--disable-setuid-sandbox");
  });

  it("disables the sandbox when explicitly requested", () => {
    const args = buildChromeArgs(
      {
        headless: true,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      { TIDESURF_NO_SANDBOX: "1" },
      1000
    );

    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-setuid-sandbox");
  });

  it("disables the sandbox when running as root", () => {
    const args = buildChromeArgs(
      {
        headless: false,
        port: 9222,
        userDataDir: "/tmp/tidesurf-profile",
      },
      {},
      0
    );

    expect(args).toContain("--no-sandbox");
    expect(args).not.toContain("--headless=new");
  });
});
