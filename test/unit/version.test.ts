import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../src/version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "..");

describe("VERSION", () => {
  it("stays in sync with package metadata", async () => {
    const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf-8")) as {
      version: string;
    };
    const mcpPkg = JSON.parse(await readFile(join(rootDir, "mcp", "package.json"), "utf-8")) as {
      version: string;
    };

    expect(VERSION).toBe(pkg.version);
    expect(VERSION).toBe(mcpPkg.version);
  });
});
