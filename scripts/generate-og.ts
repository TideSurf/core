#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { TideSurf } from "../src/index.js";
import { resolve } from "node:path";

const htmlPath = resolve(import.meta.dir, "../website/landing/public/og.html");
const outPath = resolve(import.meta.dir, "../website/landing/public/og.png");
const manifestPath = resolve(import.meta.dir, "../website/landing/public/og-manifest.json");
const ghOutPath = resolve(import.meta.dir, "../assets/social-preview.png");
const width = 1200;
const height = 630;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response(Bun.file(htmlPath), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

let surf: TideSurf | null = null;
let generationFailed = false;
try {
  surf = await TideSurf.launch({
    headless: true,
    defaultViewport: { width, height },
    allowLocalhost: true,
  });
  await surf.navigate(`http://127.0.0.1:${server.port}/`);

  const page = surf.getPage();
  await page.evaluate("document.fonts.ready");
  await page.evaluate("new Promise(resolve => setTimeout(resolve, 500))");

  const bytes = Buffer.from(await page.screenshot(), "base64");
  const source = await Bun.file(htmlPath).text();
  const manifest = {
    source: "og.html",
    sourceSha256: sha256(source),
    png: "og.png",
    pngSha256: sha256(bytes),
    width,
    height,
  };

  await Promise.all([
    Bun.write(outPath, bytes),
    Bun.write(ghOutPath, bytes),
    Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  ]);

  console.log(`OG previews written (${width}x${height}, ${(bytes.byteLength / 1024).toFixed(0)} KB):`);
  console.log(`  ${outPath}`);
  console.log(`  ${ghOutPath}`);
  console.log(`  ${manifestPath}`);
} catch (error) {
  generationFailed = true;
  throw error;
} finally {
  let closeFailure: { error: unknown } | undefined;
  try {
    await surf?.close();
  } catch (error) {
    closeFailure = { error };
  }
  server.stop(true);
  if (!generationFailed && closeFailure) throw closeFailure.error;
}
