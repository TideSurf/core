import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canResolveBrowser } from "../support/browser.js";

const root = join(import.meta.dir, "..", "..");
const cliPath = join(root, "src", "cli.ts");
const fixturePath = join(root, "test", "fixtures", "interactive.html");
const session = `cli-${randomUUID()}`;
const readOnlySession = `cli-ro-${randomUUID()}`;
const finalTabSession = `cli-final-tab-${randomUUID()}`;
let server: Server;
let url: string;

const describeCli = canResolveBrowser() ? describe : describe.skip;

function runCli(namedSession: string, ...args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [cliPath, "--session", namedSession, ...args],
      {
        cwd: root,
        env: process.env,
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

function runCliBinary(namedSession: string, ...args: string[]): Promise<{
  code: number | null;
  stdout: Buffer;
  stderr: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [cliPath, "--session", namedSession, ...args],
      { cwd: root, env: process.env }
    );
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout: Buffer.concat(stdout), stderr });
    });
  });
}

describeCli("stateful CLI integration", () => {
  beforeAll(async () => {
    server = createServer(async (_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(fixturePath));
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server failed");
    url = `http://127.0.0.1:${address.port}/interactive.html`;
  });

  afterAll(async () => {
    await runCli(session, "stop");
    await runCli(readOnlySession, "stop");
    await runCli(finalTabSession, "stop");
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  });

  it("keeps IDs and page state across separate invocations", async () => {
    const navigation = await runCli(session, "--allow-localhost", "navigate", url);
    expect(navigation.code).toBe(0);
    expect(navigation.stdout).toContain("[B1] Action");

    const state = await runCli(session, "get_state", "--full-page");
    expect(state.code).toBe(0);
    expect(state.stdout).toContain("[B1] Action");

    const called = await runCli(
      session,
      "call",
      "get_state",
      "--input",
      '{"mode":"interactive"}',
      "--json"
    );
    expect(called.code).toBe(0);
    expect(JSON.parse(called.stdout)).toMatchObject({
      success: true,
      data: expect.stringContaining("[B1] Action"),
    });

    expect((await runCli(session, "click", "B1")).code).toBe(0);
    const clicked = await runCli(
      session,
      "evaluate",
      "document.getElementById('output').textContent"
    );
    expect(clicked.stdout.trim()).toBe("clicked!");
  }, 60_000);

  it("rejects a detached stale ID without using its replacement", async () => {
    expect((await runCli(session, "navigate", url)).code).toBe(0);
    const replace = await runCli(
      session,
      "evaluate",
      "window.replacementClicks=0;const old=document.querySelector('button');const next=document.createElement('button');next.textContent='Replacement';next.onclick=()=>window.replacementClicks++;old.replaceWith(next);'replaced'"
    );
    expect(replace.code).toBe(0);

    const click = await runCli(session, "click", "B1");
    expect(click.code).toBe(4);
    expect(click.stderr).toContain("detached");
    expect((await runCli(session, "evaluate", "window.replacementClicks")).stdout.trim()).toBe("0");
  }, 60_000);

  it("persists tabs and the active tab", async () => {
    const created = await runCli(session, "new_tab", "about:blank");
    expect(created.code).toBe(0);
    const tab = JSON.parse(created.stdout) as { id: string };

    const listed = await runCli(session, "list_tabs");
    expect(listed.code).toBe(0);
    const tabs = JSON.parse(listed.stdout) as Array<{ id: string }>;
    expect(tabs).toHaveLength(2);
    expect(tabs.some((candidate) => candidate.id === tab.id)).toBe(true);

    const state = await runCli(session, "get_state");
    expect(state.stdout).toContain("> blank");
    expect(state.stdout).not.toContain("Interactive Page");
  }, 60_000);

  it("keeps a named session alive after closing its final tab", async () => {
    const initialState = await runCli(finalTabSession, "get_state");
    expect(initialState.code).toBe(0);

    const initialTabsResult = await runCli(finalTabSession, "list_tabs");
    expect(initialTabsResult.code).toBe(0);
    const initialTabs = JSON.parse(initialTabsResult.stdout) as Array<{
      id: string;
    }>;
    expect(initialTabs).toHaveLength(1);

    const closed = await runCli(
      finalTabSession,
      "close_tab",
      initialTabs[0].id
    );
    expect(closed.code).toBe(0);

    const replacementTabsResult = await runCli(finalTabSession, "list_tabs");
    expect(replacementTabsResult.code).toBe(0);
    const replacementTabs = JSON.parse(replacementTabsResult.stdout) as Array<{
      id: string;
    }>;
    expect(replacementTabs).toHaveLength(1);
    expect(replacementTabs[0].id).not.toBe(initialTabs[0].id);

    const replacementState = await runCli(finalTabSession, "get_state");
    expect(replacementState.code).toBe(0);
    expect(replacementState.stdout).toContain("> blank");
  }, 60_000);

  it("cannot weaken an established read-only policy", async () => {
    const started = await runCli(
      readOnlySession,
      "--read-only",
      "--allow-localhost",
      "get_state"
    );
    expect(started.code).toBe(0);

    const repeatedPolicy = await runCli(
      readOnlySession,
      "--read-only",
      "get_state"
    );
    expect(repeatedPolicy.code).toBe(0);

    const click = await runCli(readOnlySession, "click", "B1");
    expect(click.code).toBe(4);
    expect(click.stderr).toContain("read-only mode");

    const conflict = await runCli(readOnlySession, "--headful", "get_state");
    expect(conflict.code).toBe(3);
    expect(conflict.stderr).toContain("different startup options");
  }, 60_000);

  it("writes screenshots to unique temporary files", async () => {
    const result = await runCli(session, "screenshot", "--json");
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as {
      success: boolean;
      data: { filePath: string; totalBytes: number };
    };
    expect(output.success).toBe(true);
    expect(output.data.totalBytes).toBeGreaterThan(0);
    expect(existsSync(output.data.filePath)).toBe(true);
    rmSync(output.data.filePath, { force: true });

    const selectedPath = join(
      tmpdir(),
      `tidesurf-selected-${randomUUID()}.png`
    );
    try {
      const selected = await runCli(
        session,
        "screenshot",
        "--output",
        selectedPath
      );
      expect(selected.code).toBe(0);
      expect(selected.stdout.trim()).toBe(selectedPath);
      expect(existsSync(selectedPath)).toBe(true);
    } finally {
      rmSync(selectedPath, { force: true });
    }

    const binary = await runCliBinary(session, "screenshot", "--output", "-");
    expect(binary.code).toBe(0);
    expect(binary.stderr).toBe("");
    expect(binary.stdout.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }, 60_000);
});
