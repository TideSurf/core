import { describe, expect, it } from "bun:test";
import {
  CliUsageError,
  buildToolInput,
  parseInvocation,
} from "../../src/cli/args.js";
import { BrowserController } from "../../src/cli/browser-controller.js";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";
import { validateExpression } from "../../src/validation.js";

describe("CLI parsing", () => {
  it("uses help semantics with no command", () => {
    const invocation = parseInvocation([]);
    expect(invocation.command).toBeUndefined();
    expect(invocation.session).toBe("default");
    expect(invocation.sessionConfig.browserMode).toBe("launch");
    expect(invocation.sessionConfig.headless).toBe(true);
  });

  it("parses version and command help", () => {
    expect(parseInvocation(["--version"]).version).toBe(true);
    const help = parseInvocation(["get-state", "--help"]);
    expect(help.help).toBe(true);
    expect(help.tool?.name).toBe("get_state");
  });

  it("accepts every hyphen command and MCP underscore alias", () => {
    for (const spec of TOOL_REGISTRY) {
      expect(parseInvocation([spec.cli.command]).tool).toBe(spec);
      for (const alias of spec.cli.aliases) {
        expect(parseInvocation([alias]).tool).toBe(spec);
      }
    }
  });

  it("builds typed tool input", () => {
    const invocation = parseInvocation([
      "--session",
      "research",
      "get-state",
      "--max-tokens",
      "900",
      "--mode",
      "interactive",
      "--full-page",
      "--include-hidden",
    ]);
    expect(buildToolInput(invocation)).toEqual({
      maxTokens: 900,
      mode: "interactive",
      includeHidden: true,
      viewport: false,
    });
    expect(invocation.session).toBe("research");
  });

  it("does not apply a disabled boolean transform", () => {
    const explicitFalse = parseInvocation([
      "get-state",
      "--full-page=false",
    ]);
    const negated = parseInvocation(["get-state", "--no-full-page"]);

    expect(buildToolInput(explicitFalse)).toEqual({});
    expect(buildToolInput(negated)).toEqual({});
  });

  it("applies explicit values consistently to negated booleans", () => {
    expect(parseInvocation(["--no-json=true", "status"]).json).toBe(false);
    expect(parseInvocation(["--no-json=false", "status"]).json).toBe(true);
    expect(parseInvocation(["--no-json", "true", "status"]).json).toBe(false);
    expect(parseInvocation(["--no-json", "false", "status"]).json).toBe(true);

    expect(
      buildToolInput(parseInvocation(["get-state", "--no-viewport=false"]))
    ).toEqual({ viewport: true });
  });

  it("parses startup policy and repeated filesystem roots", () => {
    const invocation = parseInvocation([
      "--auto-connect",
      "--browser-url",
      "http://127.0.0.1:9333",
      "--channel",
      "beta",
      "--read-only",
      "--file-access-root",
      ".",
      "--file-access-root",
      "/tmp",
      "--file-access-root",
      ".",
      "status",
    ]);
    expect(invocation.sessionConfig.browserMode).toBe("auto");
    expect(invocation.sessionConfig.browserUrl).toBe("http://127.0.0.1:9333");
    expect(invocation.sessionConfig.channel).toBe("beta");
    expect(invocation.sessionConfig.readOnly).toBe(true);
    expect(invocation.sessionConfig.fileAccessRoots).toHaveLength(2);
    expect(invocation.sessionConfig.fileAccessRoots).toEqual(
      [...invocation.sessionConfig.fileAccessRoots!].sort()
    );
    expect(invocation.startupConfig).toEqual({
      browserMode: "auto",
      browserUrl: "http://127.0.0.1:9333",
      channel: "beta",
      readOnly: true,
      fileAccessRoots: invocation.sessionConfig.fileAccessRoots,
    });
  });

  it("keeps download timeout in tool input", () => {
    const invocation = parseInvocation(["download", "L2", "--timeout", "2500"]);
    expect(buildToolInput(invocation)).toEqual({ id: "L2", timeout: 2500 });
    expect(invocation.startupConfig).toEqual({});
  });

  it("parses explicit global boolean values before the command", () => {
    const invocation = parseInvocation(["--headful", "false", "status"]);
    expect(invocation.command).toBe("status");
    expect(invocation.sessionConfig.headless).toBe(true);
    expect(invocation.startupConfig).toEqual({ headless: true });
  });

  it("keeps session and download timeouts separate", () => {
    const invocation = parseInvocation([
      "--timeout",
      "7000",
      "download",
      "L2",
      "--timeout",
      "2500",
    ]);
    expect(invocation.sessionConfig.timeout).toBe(7000);
    expect(buildToolInput(invocation)).toEqual({ id: "L2", timeout: 2500 });
  });

  it("parses output controls", () => {
    const invocation = parseInvocation([
      "screenshot",
      "--element-id",
      "B4",
      "--output",
      "capture.png",
      "--json",
    ]);
    expect(buildToolInput(invocation)).toEqual({ elementId: "B4" });
    expect(invocation.screenshotOutput).toBe("capture.png");
    expect(invocation.json).toBe(true);
  });

  it("rejects malformed numbers, conflicting flags, and unknown options", () => {
    expect(() => parseInvocation(["--port", "9222x", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["--port", "0", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["--auto-connect", "--connect-only", "status"])).toThrow(
      CliUsageError
    );
    expect(() => parseInvocation(["status", "--wat"])).toThrow(CliUsageError);
    expect(() =>
      buildToolInput(parseInvocation(["get-state", "--full-page", "--viewport"]))
    ).toThrow("conflicts");
  });

  it("rejects missing and surplus positional arguments", () => {
    expect(() => buildToolInput(parseInvocation(["navigate"]))).toThrow("Missing url");
    expect(() => buildToolInput(parseInvocation(["click", "B1", "B2"]))).toThrow(
      "Unexpected argument"
    );
  });
});

describe("evaluate validation", () => {
  it("limits only shape and size", () => {
    expect(() => validateExpression("document.cookie")).not.toThrow();
    expect(() => validateExpression("fetch('/api')")).not.toThrow();
    expect(() => validateExpression("")).toThrow();
    expect(() => validateExpression("x".repeat(10_001))).toThrow();
  });
});

describe("BrowserController tool preflight", () => {
  it("rejects read-only and unknown tools without acquiring a browser", async () => {
    const controller = new BrowserController({
      browserMode: "launch",
      headless: true,
      readOnly: true,
      allowLocalhost: false,
      allowPrivateHosts: false,
    });
    try {
      await expect(controller.execute("click", { id: "B1" })).resolves.toEqual({
        success: false,
        error: 'Tool "click" is disabled in read-only mode',
      });
      await expect(controller.execute("missing", {})).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("Unknown tool: missing"),
      });
      expect(controller.status().running).toBe(false);
    } finally {
      await controller.close();
    }
  });
});
