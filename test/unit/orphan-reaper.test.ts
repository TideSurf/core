import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reapOrphanedBrowsers,
  unregisterOrphanedBrowser,
} from "../../src/cdp/launcher.js";

// Mirrors ORPHAN_REGISTRY_DIR in src/cdp/launcher.ts (not exported). Records
// created here use unique pids and are removed again, so the shared registry
// is left as it was found.
const ORPHAN_REGISTRY_DIR = join(tmpdir(), "tidesurf-orphans");

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

/** A pid no live process can own, verified dead before use. */
function deadParentPid(start: number): number {
  let pid = start;
  while (pidIsAlive(pid)) pid++;
  return pid;
}

interface OrphanFixture {
  child: ChildProcess;
  chromePid: number;
  parentPid: number;
  userDataDir: string;
  recordPath: string;
}

async function spawnSleeper(extraArgs: string[] = []): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", ...extraArgs],
    { stdio: "ignore" }
  );
  await once(child, "spawn");
  return child;
}

async function createOrphanFixture(
  salt: number,
  options: { withProfileFlag: boolean }
): Promise<OrphanFixture> {
  const userDataDir = mkdtempSync(join(tmpdir(), `tidesurf-orphan-${salt}-`));
  const child = options.withProfileFlag
    ? await spawnSleeper([`--user-data-dir=${userDataDir}`])
    : await spawnSleeper();
  const chromePid = child.pid!;
  const parentPid = deadParentPid(2 ** 22 + salt);
  const record = {
    chromePid,
    parentPid,
    userDataDir,
    ownsTempDir: true,
    createdAt: Date.now(),
  };
  mkdirSync(ORPHAN_REGISTRY_DIR, { recursive: true, mode: 0o700 });
  const recordPath = join(ORPHAN_REGISTRY_DIR, `${parentPid}-${chromePid}.json`);
  writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  return { child, chromePid, parentPid, userDataDir, recordPath };
}

async function stopSleeper(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
}

function cleanupFixture(fixture: OrphanFixture): void {
  rmSync(fixture.recordPath, { force: true });
  rmSync(fixture.userDataDir, { recursive: true, force: true });
}

describe("orphaned browser reaper", () => {
  it("kills a browser whose parent died and removes its temp profile", async () => {
    if (process.platform === "win32") return;
    const fixture = await createOrphanFixture(12_345, { withProfileFlag: true });
    expect(pidIsAlive(fixture.parentPid)).toBe(false);
    expect(pidIsAlive(fixture.chromePid)).toBe(true);
    const exited = once(fixture.child, "exit");

    try {
      await reapOrphanedBrowsers();

      await Promise.race([
        exited,
        new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000)),
      ]);
      expect(pidIsAlive(fixture.chromePid)).toBe(false);
      expect(existsSync(fixture.userDataDir)).toBe(false);
      expect(existsSync(fixture.recordPath)).toBe(false);
    } finally {
      await stopSleeper(fixture.child);
      cleanupFixture(fixture);
    }
  });

  it("spares a recycled pid whose command line is not the recorded browser", async () => {
    if (process.platform === "win32") return;
    // The record claims this sleeper is the orphaned Chrome, but its argv
    // lacks the recorded userDataDir: the pid was reused by someone else.
    const fixture = await createOrphanFixture(54_321, { withProfileFlag: false });
    expect(pidIsAlive(fixture.parentPid)).toBe(false);
    expect(pidIsAlive(fixture.chromePid)).toBe(true);

    try {
      await reapOrphanedBrowsers();

      expect(pidIsAlive(fixture.chromePid)).toBe(true);
      expect(existsSync(fixture.recordPath)).toBe(false);
    } finally {
      await stopSleeper(fixture.child);
      cleanupFixture(fixture);
    }
  });

  it("unregisters records best-effort", () => {
    if (process.platform === "win32") return;
    const parentPid = 2 ** 22 + 66_777;
    const chromePid = 2 ** 22 + 66_778;
    const recordPath = join(ORPHAN_REGISTRY_DIR, `${parentPid}-${chromePid}.json`);
    mkdirSync(ORPHAN_REGISTRY_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(recordPath, "{}", { mode: 0o600 });

    unregisterOrphanedBrowser(parentPid, chromePid);
    expect(existsSync(recordPath)).toBe(false);
    expect(() => unregisterOrphanedBrowser(parentPid, chromePid)).not.toThrow();
  });
});
