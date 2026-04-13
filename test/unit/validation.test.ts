import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveFileAccessRoots,
  validateUrl,
  validateSelector,
  validateExpression,
  validateElementId,
  validatePort,
  validateFilePath,
  validateUploadFilePath,
  validateDownloadDirectory,
  validatePositiveInteger,
  validatePositiveNumber,
  validateSearchQuery,
} from "../../src/validation.js";
import { ValidationError } from "../../src/errors.js";

describe("validateUrl", () => {
  it("accepts valid http URLs", () => {
    expect(() => validateUrl("http://example.com")).not.toThrow();
    expect(() => validateUrl("https://example.com/path?q=1")).not.toThrow();
    expect(() => validateUrl("about:blank")).not.toThrow();
  });

  it("rejects data: URLs (HIGH-019)", () => {
    expect(() => validateUrl("data:text/html,<h1>Test</h1>")).toThrow(ValidationError);
    expect(() => validateUrl("data:text/html,<script>alert(1)</script>")).toThrow(ValidationError);
  });

  it("rejects private IP addresses (SSRF prevention)", () => {
    expect(() => validateUrl("http://localhost/path")).toThrow(ValidationError);
    expect(() => validateUrl("http://127.0.0.1/path")).toThrow(ValidationError);
    expect(() => validateUrl("http://10.0.0.1/path")).toThrow(ValidationError);
    expect(() => validateUrl("http://192.168.1.1/path")).toThrow(ValidationError);
    expect(() => validateUrl("http://172.16.0.1/path")).toThrow(ValidationError);
    expect(() => validateUrl("http://[::1]/path")).toThrow(ValidationError);
  });

  it("rejects punycode hostnames (IDN homograph prevention)", () => {
    // xn-- prefix indicates punycode encoding (IDN)
    expect(() => validateUrl("http://xn--e1awd7f.com")).toThrow(ValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow(ValidationError);
  });

  it("rejects non-http URLs", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow(ValidationError);
    expect(() => validateUrl("javascript:alert(1)")).toThrow(ValidationError);
  });

  it("rejects malformed URLs and whitespace", () => {
    expect(() => validateUrl("https://exa mple.com")).toThrow(ValidationError);
    expect(() => validateUrl("http://")).toThrow(ValidationError);
  });

  it("rejects URLs over 2048 characters (NEW-CRIT-004)", () => {
    const longPath = "a".repeat(2100);
    expect(() => validateUrl(`https://example.com/${longPath}`)).toThrow(ValidationError);
    expect(() => validateUrl(`https://example.com/${longPath}`)).toThrow("2048");
  });

  it("accepts URLs at the 2048 character limit", () => {
    // URL with exactly 2048 characters should pass
    const baseUrl = "https://example.com/";
    const padding = "x".repeat(2048 - baseUrl.length);
    expect(() => validateUrl(`${baseUrl}${padding}`)).not.toThrow();
  });
});

describe("validateSelector", () => {
  it("accepts valid selectors", () => {
    expect(() => validateSelector("#id")).not.toThrow();
    expect(() => validateSelector(".class > div")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateSelector("")).toThrow(ValidationError);
  });

  it("rejects overly long selectors", () => {
    expect(() => validateSelector("a".repeat(1001))).toThrow(ValidationError);
  });
});

describe("validateExpression", () => {
  it("accepts valid expressions", () => {
    expect(() => validateExpression("document.title")).not.toThrow();
    expect(() => validateExpression("1+1")).not.toThrow();
    expect(() => validateExpression("window.location.href")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateExpression("")).toThrow(ValidationError);
  });

  it("rejects overly long expressions", () => {
    expect(() => validateExpression("x".repeat(10001))).toThrow(ValidationError);
  });

  it("rejects document.cookie (CRIT-002)", () => {
    expect(() => validateExpression("document.cookie")).toThrow(ValidationError);
    expect(() => validateExpression("document.cookie.split(';')")).toThrow(ValidationError);
  });

  it("rejects storage APIs (CRIT-002)", () => {
    expect(() => validateExpression("localStorage.getItem('key')")).toThrow(ValidationError);
    expect(() => validateExpression("sessionStorage.setItem('k', 'v')")).toThrow(ValidationError);
    expect(() => validateExpression("indexedDB.open('db')")).toThrow(ValidationError);
  });

  it("rejects network APIs (CRIT-002)", () => {
    expect(() => validateExpression("fetch('https://attacker.com')")).toThrow(ValidationError);
    expect(() => validateExpression("new XMLHttpRequest()")).toThrow(ValidationError);
    expect(() => validateExpression("new WebSocket('wss://evil.com')")).toThrow(ValidationError);
  });

  it("rejects code execution APIs (CRIT-002)", () => {
    expect(() => validateExpression("eval('alert(1)')")).toThrow(ValidationError);
    expect(() => validateExpression("Function('return 1')()")).toThrow(ValidationError);
  });
});

describe("validateElementId", () => {
  it("accepts valid element IDs", () => {
    expect(() => validateElementId("B1")).not.toThrow();
    expect(() => validateElementId("L23")).not.toThrow();
    expect(() => validateElementId("I5")).not.toThrow();
    expect(() => validateElementId("S100")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateElementId("")).toThrow(ValidationError);
  });

  it("rejects invalid formats", () => {
    expect(() => validateElementId("b1")).toThrow(ValidationError);
    expect(() => validateElementId("button")).toThrow(ValidationError);
    expect(() => validateElementId("1B")).toThrow(ValidationError);
    expect(() => validateElementId("B")).toThrow(ValidationError);
  });
});

describe("validatePort", () => {
  it("accepts valid ports", () => {
    expect(() => validatePort(1)).not.toThrow();
    expect(() => validatePort(80)).not.toThrow();
    expect(() => validatePort(9222)).not.toThrow();
    expect(() => validatePort(65535)).not.toThrow();
  });

  it("rejects port 0", () => {
    expect(() => validatePort(0)).toThrow(ValidationError);
  });

  it("rejects negative ports", () => {
    expect(() => validatePort(-1)).toThrow(ValidationError);
  });

  it("rejects ports above 65535", () => {
    expect(() => validatePort(99999)).toThrow(ValidationError);
  });

  it("rejects NaN", () => {
    expect(() => validatePort(NaN)).toThrow(ValidationError);
  });

  it("rejects floats", () => {
    expect(() => validatePort(80.5)).toThrow(ValidationError);
  });
});

describe("validateFilePath", () => {
  it("accepts non-empty strings", () => {
    expect(() => validateFilePath("/tmp/file.txt")).not.toThrow();
    expect(() => validateFilePath("relative/path.png")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateFilePath("")).toThrow(ValidationError);
  });

  it("rejects undefined (via type coercion)", () => {
    expect(() => validateFilePath(undefined as unknown as string)).toThrow(
      ValidationError
    );
  });

  it("rejects null bytes", () => {
    expect(() => validateFilePath("bad\0path")).toThrow(ValidationError);
  });
});

describe("resolveFileAccessRoots", () => {
  it("defaults to cwd and tmpdir", () => {
    const roots = resolveFileAccessRoots();

    expect(roots).toContain(realpathSync.native(process.cwd()));
    expect(roots).toContain(realpathSync.native(tmpdir()));
  });
});

describe("validateUploadFilePath", () => {
  it("accepts files inside allowed roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "tidesurf-upload-root-"));
    const filePath = join(root, "input.txt");

    try {
      await writeFile(filePath, "hello");
      expect(validateUploadFilePath(filePath, [root])).toBe(
        realpathSync.native(filePath)
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects files outside allowed roots", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-allowed-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tidesurf-outside-"));
    const filePath = join(outsideRoot, "secret.txt");

    try {
      await writeFile(filePath, "secret");
      expect(() => validateUploadFilePath(filePath, [allowedRoot])).toThrow(
        ValidationError
      );
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-allowed-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tidesurf-outside-"));
    const outsideFile = join(outsideRoot, "secret.txt");
    const linkedPath = join(allowedRoot, "linked.txt");

    try {
      await writeFile(outsideFile, "secret");
      await symlink(outsideFile, linkedPath);
      expect(() => validateUploadFilePath(linkedPath, [allowedRoot])).toThrow(
        ValidationError
      );
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("validateDownloadDirectory", () => {
  it("accepts new directories inside allowed roots", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-download-root-"));
    const targetDir = join(allowedRoot, "downloads", "nested");

    try {
      expect(validateDownloadDirectory(targetDir, [allowedRoot])).toBe(targetDir);
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
    }
  });

  it("rejects directories outside allowed roots", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-download-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tidesurf-download-outside-"));

    try {
      expect(() =>
        validateDownloadDirectory(join(outsideRoot, "downloads"), [allowedRoot])
      ).toThrow(ValidationError);
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlink ancestors that escape allowed roots", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "tidesurf-download-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tidesurf-download-outside-"));
    const symlinkPath = join(allowedRoot, "escape-link");

    try {
      await symlink(outsideRoot, symlinkPath);
      expect(() =>
        validateDownloadDirectory(join(symlinkPath, "downloads"), [allowedRoot])
      ).toThrow(ValidationError);
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("validatePositiveInteger", () => {
  it("accepts positive integers", () => {
    expect(() => validatePositiveInteger(1, "maxResults")).not.toThrow();
  });

  it("rejects zero, negatives, and floats", () => {
    expect(() => validatePositiveInteger(0, "maxResults")).toThrow(ValidationError);
    expect(() => validatePositiveInteger(-1, "maxResults")).toThrow(ValidationError);
    expect(() => validatePositiveInteger(1.5, "maxResults")).toThrow(ValidationError);
  });
});

describe("validatePositiveNumber", () => {
  it("accepts positive numbers", () => {
    expect(() => validatePositiveNumber(0.5, "amount")).not.toThrow();
  });

  it("rejects zero, negatives, and infinities", () => {
    expect(() => validatePositiveNumber(0, "amount")).toThrow(ValidationError);
    expect(() => validatePositiveNumber(-1, "amount")).toThrow(ValidationError);
    expect(() => validatePositiveNumber(Infinity, "amount")).toThrow(ValidationError);
  });
});

describe("validateSearchQuery", () => {
  it("accepts non-empty search queries", () => {
    expect(() => validateSearchQuery("login")).not.toThrow();
  });

  it("rejects blank or overly long search queries", () => {
    expect(() => validateSearchQuery("   ")).toThrow(ValidationError);
    expect(() => validateSearchQuery("a".repeat(1001))).toThrow(ValidationError);
  });
});
