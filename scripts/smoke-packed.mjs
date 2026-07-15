import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "tidesurf-pack-smoke-"));
const installRoot = join(workspace, "install");
const minimalInstallRoot = join(workspace, "install-minimal");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const bin = join(
  installRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tidesurf.cmd" : "tidesurf"
);
const nodeSession = `pack-node-${randomUUID()}`;
const bunSession = `pack-bun-${randomUUID()}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    env: process.env,
  });
  const expected = options.expected ?? [0];
  if (
    result.error ||
    !expected.includes(result.status) ||
    (options.stderrIncludes && !result.stderr.includes(options.stderrIncludes))
  ) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `Exit: ${result.status}`,
        result.error?.stack,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n")
    );
  }
  return result.stdout;
}

function cli(runtime, cliPath, session, ...args) {
  return run(runtime, [cliPath, "--session", session, ...args]);
}

function assertSession(output, session) {
  const parsed = JSON.parse(output);
  if (!parsed.success || parsed.data?.session !== session) {
    throw new Error(`Packed CLI returned invalid session status: ${output}`);
  }
}

let cliPath;
try {
  const packedName = run(npm, [
    "pack",
    "--silent",
    "--pack-destination",
    workspace,
  ]).trim().split(/\r?\n/).at(-1);
  if (!packedName) throw new Error("npm pack did not return a tarball name");

  run(npm, [
    "install",
    "--ignore-scripts",
    "--prefix",
    installRoot,
    join(workspace, packedName),
  ]);
  run(npm, [
    "install",
    "--ignore-scripts",
    "--omit=optional",
    "--prefix",
    minimalInstallRoot,
    join(workspace, packedName),
  ]);
  cliPath = join(
    installRoot,
    "node_modules",
    "@tidesurf",
    "core",
    "dist",
    "cli.js"
  );
  const minimalCliPath = join(
    minimalInstallRoot,
    "node_modules",
    "@tidesurf",
    "core",
    "dist",
    "cli.js"
  );
  const packageRoot = join(
    installRoot,
    "node_modules",
    "@tidesurf",
    "core"
  );
  for (const stalePath of [
    "dist/mcp/index.js",
    "dist/tools/definitions.js",
    "dist/tools/executor.js",
  ]) {
    if (existsSync(join(packageRoot, stalePath))) {
      throw new Error(`Packed artifact contains removed module: ${stalePath}`);
    }
  }

  run(bin, ["--help"]);
  run(process.execPath, [cliPath, "--version"]);
  run("bun", [cliPath, "--version"]);
  run(process.execPath, [minimalCliPath, "mcp", "--quiet"], {
    cwd: minimalInstallRoot,
    expected: [5],
    stderrIncludes:
      "MCP dependencies are unavailable. Install @modelcontextprotocol/sdk and zod.",
  });
  run("bun", [minimalCliPath, "mcp", "--quiet"], {
    cwd: minimalInstallRoot,
    expected: [5],
    stderrIncludes:
      "MCP dependencies are unavailable. Install @modelcontextprotocol/sdk and zod.",
  });

  run(
    process.execPath,
    [cliPath, "--session", nodeSession, "--connect-only", "--port", "1", "start"],
    { expected: [3] }
  );
  run(
    "bun",
    [cliPath, "--session", bunSession, "--connect-only", "--port", "1", "start"],
    { expected: [3] }
  );
  assertSession(cli(process.execPath, cliPath, nodeSession, "status", "--json"), nodeSession);
  assertSession(cli("bun", cliPath, bunSession, "status", "--json"), bunSession);
  cli(process.execPath, cliPath, nodeSession, "stop");
  cli("bun", cliPath, bunSession, "stop");

  const mcpSmoke = join(root, "test", "scripts", "mcp-stdio-smoke.mjs");
  run(process.execPath, [mcpSmoke, cliPath]);
  run("bun", [mcpSmoke, cliPath]);
  process.stdout.write(
    "Packed CLI and MCP smoke passed under Node and Bun, including omit-optional behavior.\n"
  );
} finally {
  if (cliPath) {
    spawnSync(process.execPath, [cliPath, "--session", nodeSession, "stop"], {
      cwd: root,
      stdio: "ignore",
      timeout: 20_000,
    });
    spawnSync("bun", [cliPath, "--session", bunSession, "stop"], {
      cwd: root,
      stdio: "ignore",
      timeout: 20_000,
    });
  }
  rmSync(workspace, { recursive: true, force: true });
}
