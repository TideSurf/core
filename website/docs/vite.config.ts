import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/docs/",
  build: {
    outDir: "dist",
  },
  assetsInclude: ["**/*.md"],
});
