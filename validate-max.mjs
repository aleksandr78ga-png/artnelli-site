import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = process.cwd();
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(resolve(root, "catalog-data.js"), "utf8"), context);
const products = context.window.NELLI_CATALOG;

assert(Array.isArray(products), "Catalog does not expose window.NELLI_CATALOG");
assert(products?.length > 0, "Catalog is empty");
assert(
  new Set((products || []).map((product) => product.id)).size === products?.length,
  "Catalog contains duplicate product ids",
);
const syncStatePath = resolve(root, "catalog-sync-state.json");
if (existsSync(syncStatePath)) {
  const syncState = JSON.parse(readFileSync(syncStatePath, "utf8"));
  assert(
    syncState.productCount === products?.length,
    `Catalog count differs from sync state: ${products?.length || 0} vs ${syncState.productCount}`,
  );
  assert(
    syncState.source === "https://t.me/nelli_leotards",
    "Catalog sync source is not the primary Telegram catalogue",
  );
}

const newProducts = products?.filter((product) => product.condition === "new") || [];
const usedProducts = products?.filter((product) => product.condition === "used") || [];
assert(newProducts.length > 0, "Catalog has no new products");
assert(usedProducts.length > 0, "Catalog has no used products");
assert(newProducts.length + usedProducts.length === products?.length, "Catalog has products without a condition");

for (const product of products || []) {
  assert(product.id, "A catalog product is missing an id");
  assert(product.name, `Product ${product.id || "unknown"} is missing a name`);
  assert(product.photos?.length, `Product ${product.id || "unknown"} has no photos`);
  for (const photo of product.photos || []) {
    assert(existsSync(resolve(root, photo)), `Missing product photo: ${photo}`);
  }
}

const html = readFileSync(resolve(root, "max", "index.html"), "utf8");
const requiredMarkers = [
  'id="catalog-grid"',
  'id="product-dialog"',
  'id="order-dialog"',
  'https://st.max.ru/js/max-web-app.js',
  'https://artnelli-leotards.aleksandr78ga.chatgpt.site/max/og-site.png',
  '../assets/site/hero-video.mp4',
  'Арт-мастерская · ручная работа · Тюмень',
  'Купальник как <em>искусство.</em>',
  'data-condition="new"',
  'data-condition="used"',
  './privacy.html',
  './terms.html',
];
for (const marker of requiredMarkers) {
  assert(html.includes(marker), `MAX page is missing: ${marker}`);
}
assert(!html.includes("../assets/site/hero.jpg"), "MAX hero still uses the old static image");

const privacy = readFileSync(resolve(root, "max", "privacy.html"), "utf8");
for (const marker of [
  "Гаркуша Нелли Тимуровна",
  "860220051882",
  "314723227400162",
  "nelli.garkusha@mail.ru",
]) {
  assert(privacy.includes(marker), `Privacy policy is missing company detail: ${marker}`);
}

for (const file of [
  "max/app.js",
  "max/styles.css",
  "max/privacy.html",
  "max/terms.html",
  "max/og.png",
  "dist/client/max/index.html",
  "dist/client/max/app.js",
  "dist/client/max/og.png",
  "dist/server/index.js",
  "dist/.openai/hosting.json",
]) {
  assert(existsSync(resolve(root, file)), `Missing required file: ${file}`);
}

new vm.Script(readFileSync(resolve(root, "max", "app.js"), "utf8"), {
  filename: "max/app.js",
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`MAX mini-app validation passed: ${products.length} catalog products.`);
}
