import { cpSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = process.cwd();

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "copy-artnelli-static-files",
      closeBundle() {
        const output = resolve(root, "dist");
        mkdirSync(output, { recursive: true });
        cpSync(resolve(root, "assets"), resolve(output, "assets"), {
          recursive: true,
        });

        for (const file of [
          "catalog-data.js",
          "robots.txt",
          "sitemap.xml",
          "_headers",
        ]) {
          copyFileSync(resolve(root, file), resolve(output, file));
        }
      },
    },
  ],
});
