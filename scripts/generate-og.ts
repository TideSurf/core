#!/usr/bin/env bun
/**
 * Generates og.png social preview image using headless Chrome.
 * Usage: bun scripts/generate-og.ts
 */
import { TideSurf } from "../src/index.js";
import { resolve } from "path";

const htmlPath = resolve(import.meta.dir, "../website/landing/public/og.html");
const outPath = resolve(import.meta.dir, "../website/landing/public/og.png");
const ghOutPath = resolve(import.meta.dir, "../assets/social-preview.png");

// Serve the file locally
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const file = Bun.file(htmlPath);
    return new Response(file, { headers: { "Content-Type": "text/html" } });
  },
});

const surf = await TideSurf.launch({ headless: true });
await surf.navigate(`http://localhost:${server.port}/`);

// Wait for fonts
const page = surf.getPage();
await page.evaluate("document.fonts.ready");
await page.evaluate("new Promise(r => setTimeout(r, 500))");

// Screenshot via CDP
const conn = (page as any).conn;
const { data } = await conn.Page.captureScreenshot({
  format: "png",
  clip: { x: 0, y: 0, width: 1200, height: 630, scale: 2 },
});

const buf = Buffer.from(data, "base64");
await Bun.write(outPath, buf);
await Bun.write(ghOutPath, buf);

console.log(`OG image written to:`);
console.log(`  ${outPath}`);
console.log(`  ${ghOutPath}`);
console.log(`  ${(buf.byteLength / 1024).toFixed(0)} KB`);

await surf.close();
server.stop();
