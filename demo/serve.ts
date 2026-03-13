/**
 * Demo server — serves the TideTravel demo site locally.
 *
 *   bun run demo          # http://localhost:3456
 *   PORT=8080 bun run demo
 */

import { join, normalize } from "node:path";
import { validatePort } from "../src/validation.js";

const PORT = parseInt(process.env.PORT || "3456", 10);
validatePort(PORT);
const DIR = new URL("../website/landing/public/demo", import.meta.url).pathname;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = normalize(url.pathname);

    // Serve index.html for / or /index.html
    if (path === "/" || path === "/index.html") {
      path = "/index.html";
    }

    const filePath = join(DIR, `.${path}`);
    if (!filePath.startsWith(DIR)) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  TideTravel demo → http://127.0.0.1:${server.port}/\n`);
