import {
  copyFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
const client = resolve(output, "client");

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "server"), { recursive: true });
mkdirSync(resolve(output, ".openai"), { recursive: true });
mkdirSync(client, { recursive: true });

copyFileSync(resolve(root, "server", "index.js"), resolve(output, "server", "index.js"));
copyFileSync(resolve(root, ".openai", "hosting.json"), resolve(output, ".openai", "hosting.json"));
copyDirectory(resolve(root, "assets"), resolve(client, "assets"));

for (const file of [
  "index.html",
  "catalog-data.js",
  "robots.txt",
  "sitemap.xml",
  "_headers",
]) {
  copyFileSync(resolve(root, file), resolve(client, file));
}

console.log("Art Nelli production bundle created in dist/.");