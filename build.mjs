import {
  copyFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
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
const catalogSource = readFileSync(resolve(root, "catalog-data.js"), "utf8");
const catalogMatch = catalogSource.match(
  /^\s*window\.NELLI_CATALOG\s*=\s*(\[[\s\S]*\]);?\s*$/,
);
if (!catalogMatch) {
  throw new Error("Unable to read catalog-data.js");
}
const catalogIds = JSON.parse(catalogMatch[1])
  .map((product) => Number(product.id))
  .filter(Number.isFinite);
writeFileSync(
  resolve(output, "server", "catalog-ids.js"),
  "export default " + JSON.stringify(catalogIds) + ";\n",
);
writeFileSync(
  resolve(output, "server", "catalog-products.js"),
  "export default " +
    JSON.stringify(
      JSON.parse(catalogMatch[1]).map((product) => ({
        id: Number(product.id),
        description: String(product.description || ""),
      })),
    ) +
    ";\n",
);
copyFileSync(resolve(root, ".openai", "hosting.json"), resolve(output, ".openai", "hosting.json"));
copyDirectory(resolve(root, "db", "migrations"), resolve(output, ".openai", "drizzle"));
copyDirectory(resolve(root, "assets"), resolve(client, "assets"));
copyDirectory(resolve(root, "max"), resolve(client, "max"));

for (const file of [
  "index.html",
  "catalog-data.js",
  "analytics.js",
  "seo.css",
  "robots.txt",
  "sitemap.xml",
  "_headers",
]) {
  copyFileSync(resolve(root, file), resolve(client, file));
}

for (const directory of [
  "poshiv-kupalnikov-dlya-hudozhestvennoy-gimnastiki",
  "kupalniki-dlya-hudozhestvennoy-gimnastiki-v-nalichii",
  "kak-snyat-merki-dlya-kupalnika",
  "statistika",
]) {
  copyDirectory(resolve(root, directory), resolve(client, directory));
}

console.log("Art Nelli production bundle with MAX mini-app created in dist/.");
