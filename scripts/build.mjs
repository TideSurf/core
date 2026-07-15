import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [join(root, "node_modules", "typescript", "bin", "tsc")],
  { cwd: root, stdio: "inherit" }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
