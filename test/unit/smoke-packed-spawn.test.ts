import { describe, expect, it } from "bun:test";
import { quoteCmdArg, run, spawnPlan } from "../../scripts/smoke-packed.mjs";

describe("quoteCmdArg", () => {
  it("leaves plain tokens unquoted", () => {
    expect(quoteCmdArg("pack")).toBe("pack");
    expect(quoteCmdArg("--pack-destination")).toBe("--pack-destination");
    expect(quoteCmdArg("C:\\Temp\\pkg.tgz")).toBe("C:\\Temp\\pkg.tgz");
  });

  it("quotes whitespace, cmd metacharacters, and empty arguments", () => {
    expect(quoteCmdArg("C:\\Users\\Some User\\pkg.tgz")).toBe(
      '"C:\\Users\\Some User\\pkg.tgz"'
    );
    expect(quoteCmdArg("a&b")).toBe('"a&b"');
    expect(quoteCmdArg("")).toBe('""');
  });

  it("escapes embedded quotes and trailing backslashes inside quotes", () => {
    expect(quoteCmdArg('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCmdArg("C:\\my dir\\")).toBe('"C:\\my dir\\\\"');
  });
});

describe("spawnPlan", () => {
  it("runs .cmd shims through a shell on win32", () => {
    const plan = spawnPlan(
      "npm.cmd",
      ["pack", "--json", "--pack-destination", "C:\\Temp\\pack smoke"],
      "win32"
    );
    expect(plan.shell).toBe(true);
    expect(plan.args).toEqual([]);
    expect(plan.command).toBe(
      'npm.cmd pack --json --pack-destination "C:\\Temp\\pack smoke"'
    );
  });

  it("quotes a shim path containing spaces", () => {
    const plan = spawnPlan(
      "C:\\install dir\\node_modules\\.bin\\tidesurf.CMD",
      ["--help"],
      "win32"
    );
    expect(plan.shell).toBe(true);
    expect(plan.command).toBe(
      '"C:\\install dir\\node_modules\\.bin\\tidesurf.CMD" --help'
    );
  });

  it("leaves win32 non-shim executables untouched", () => {
    const args = ["dist/cli.js", "--version"];
    const plan = spawnPlan("C:\\Program Files\\nodejs\\node.exe", args, "win32");
    expect(plan.command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(plan.args).toBe(args);
    expect(plan.shell).toBe(false);
  });

  it("keeps POSIX invocations untouched even for .cmd names", () => {
    const args = ["pack", "--json"];
    for (const platform of ["darwin", "linux"]) {
      for (const command of ["npm", "npm.cmd"]) {
        const plan = spawnPlan(command, args, platform);
        expect(plan.command).toBe(command);
        expect(plan.args).toBe(args);
        expect(plan.shell).toBe(false);
      }
    }
  });
});

describe("run", () => {
  it("returns stdout on success", () => {
    expect(run(process.execPath, ["-e", "process.stdout.write('packed-ok')"])).toBe(
      "packed-ok"
    );
  });

  it("names the command when the spawn reports an error", () => {
    expect(() => run("tidesurf-missing-binary-xyz", ["--flag"])).toThrow(
      /Command failed: tidesurf-missing-binary-xyz --flag/
    );
  });

  it("names the command when spawnSync throws synchronously", () => {
    expect(() => run("echo", ["hi"], { cwd: 123 })).toThrow(
      /Command failed to spawn: echo hi/
    );
  });
});
