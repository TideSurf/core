import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { marked } from "marked";

const HTML_QUERY = "?html";

/* Markdown compiles to HTML at build time; the client ships no parser. */
function markdownToHtml(): Plugin {
  return {
    name: "tidesurf:markdown-to-html",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(`.md${HTML_QUERY}`)) return null;
      const markdown = readFileSync(id.slice(0, -HTML_QUERY.length), "utf8");
      return `export default ${JSON.stringify(marked.parse(markdown, { async: false }))};`;
    },
  };
}

export default defineConfig({
  root: ".",
  base: "/docs/",
  build: {
    outDir: "dist",
  },
  assetsInclude: ["**/*.md"],
  plugins: [markdownToHtml()],
});
