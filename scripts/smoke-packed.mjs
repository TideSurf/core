import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export function quoteCmdArg(value) {
  const text = String(value);
  if (text !== "" && !/[\s"^&|<>()%!]/.test(text)) {
    return text;
  }
  return `"${text.replace(/(\\*)$/, "$1$1").replace(/"/g, '""')}"`;
}

// Node's CVE-2024-27980 hardening rejects spawnSync of .cmd shims without a
// shell, so Windows shims run through the shell with pre-quoted arguments.
export function spawnPlan(command, args, platform = process.platform) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: [command, ...args].map(quoteCmdArg).join(" "),
      args: [],
      shell: true,
    };
  }
  return { command, args, shell: false };
}

export function run(command, args, options = {}) {
  const plan = spawnPlan(command, args);
  let result;
  try {
    result = spawnSync(plan.command, plan.args, {
      cwd: options.cwd ?? root,
      encoding: "utf8",
      timeout: options.timeout ?? 120_000,
      env: process.env,
      ...(plan.shell ? { shell: true } : {}),
    });
  } catch (error) {
    throw new Error(
      `Command failed to spawn: ${command} ${args.join(" ")}\n${error.stack ?? error}`
    );
  }
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

function assertVersion(output, runtime) {
  if (output.trim() !== packageJson.version) {
    throw new Error(
      `${runtime} packed CLI returned ${JSON.stringify(output.trim())}; expected ${packageJson.version}`
    );
  }
}

function main() {
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

  let cliPath;
  try {
    const packOutput = JSON.parse(run(npm, [
      "pack",
      "--json",
      "--pack-destination",
      workspace,
    ]));
    if (!Array.isArray(packOutput) || packOutput.length !== 1) {
      throw new Error(`npm pack returned invalid metadata: ${JSON.stringify(packOutput)}`);
    }
    const packed = packOutput[0];
    if (!packed || typeof packed !== "object") {
      throw new Error(`npm pack returned invalid metadata: ${JSON.stringify(packed)}`);
    }
    if (packed.name !== packageJson.name || packed.version !== packageJson.version) {
      throw new Error(
        `Packed ${packed.name}@${packed.version}; expected ${packageJson.name}@${packageJson.version}`
      );
    }
    if (
      typeof packed.filename !== "string" ||
      packed.filename !== packed.filename.split(/[\\/]/).at(-1)
    ) {
      throw new Error(`npm pack returned an invalid filename: ${packed.filename}`);
    }
    const packedPath = join(workspace, packed.filename);
    if (!existsSync(packedPath) || !statSync(packedPath).isFile()) {
      throw new Error(`npm pack did not create ${packed.filename}`);
    }
    // The shipped Agent Plugin artifacts must survive packing; an ignore
    // rule once swallowed skills/ from git, and CI packs from a checkout.
    const packedFiles = new Set(
      Array.isArray(packed.files)
        ? packed.files
            .map((entry) =>
              typeof entry === "object" && entry !== null
                ? entry.path
                : undefined
            )
            .filter((path) => typeof path === "string")
        : []
    );
    for (const required of [
      "plugin.json",
      "mcp.json",
      "skills/tidesurf-browser/SKILL.md",
      "skills/tidesurf-browser/references/tool-reference.md",
    ]) {
      if (!packedFiles.has(required)) {
        throw new Error(`packed tarball is missing ${required}`);
      }
    }

    run(npm, [
      "install",
      "--ignore-scripts",
      "--prefix",
      installRoot,
      packedPath,
    ]);
    run(npm, [
      "install",
      "--ignore-scripts",
      "--omit=optional",
      "--prefix",
      minimalInstallRoot,
      packedPath,
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
    assertVersion(run(process.execPath, [cliPath, "--version"]), "Node");
    assertVersion(run("bun", [cliPath, "--version"]), "Bun");
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
