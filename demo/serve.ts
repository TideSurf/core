/**
 * Demo server — serves the TideTravel demo site locally.
 *
 *   bun run demo          # http://localhost:3456
 *   PORT=8080 bun run demo
 */

const PORT = parseInt(process.env.PORT || "3456");
const DIR = new URL("../website/landing/public/demo", import.meta.url).pathname;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Serve index.html for / or /index.html
    if (path === "/" || path === "/index.html") {
      path = "/index.html";
    }

    const file = Bun.file(`${DIR}${path}`);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  TideTravel demo → http://localhost:${server.port}/\n`);
