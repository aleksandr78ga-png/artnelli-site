import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = new URL(
  process.env.NELLI_CATALOG_BACKEND ||
    "https://artnelli-leotards.aleksandr78ga.chatgpt.site/",
);

function extractJson(source, variableName) {
  const marker = `window.${variableName}`;
  const markerIndex = source.indexOf(marker);
  const equalsIndex = source.indexOf("=", markerIndex + marker.length);
  if (markerIndex < 0 || equalsIndex < 0) throw new Error(`${marker} не найден`);
  let start = equalsIndex + 1;
  while (/\s/.test(source[start] || "")) start += 1;
  const opening = source[start];
  const closing = opening === "[" ? "]" : opening === "{" ? "}" : "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) {
      return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error(`${marker} повреждён`);
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(await readFile(path.join(root, "catalog-data.js"), "utf8"), context);
const localProducts = context.window.NELLI_CATALOG;
if (!Array.isArray(localProducts) || localProducts.length === 0) {
  throw new Error("Локальный каталог пуст или повреждён");
}

const liveUrl = new URL("/api/live-data.js", backend);
liveUrl.searchParams.set("catalog_check", String(Date.now()));
const response = await fetch(liveUrl, {
  headers: { "user-agent": "Art-Nelli-catalog-check/1.0" },
});
if (!response.ok) throw new Error(`Сервер каталога: ${response.status}`);
const live = extractJson(await response.text(), "NELLI_LIVE");
const telegram = live?.telegram;
if (!telegram || telegram.ok !== true || !Array.isArray(telegram.products)) {
  throw new Error("Telegram-синхронизация вернула неполные данные");
}

const removedIds = new Set(
  (telegram.statuses || [])
    .filter((status) => status?.removed === true)
    .map((status) => Number(status.id))
    .filter(Number.isFinite),
);
for (const product of telegram.products) {
  const id = Number(product?.id);
  if (product?.removed === true && Number.isFinite(id)) removedIds.add(id);
}
const result = new Map(
  localProducts
    .filter((product) => !removedIds.has(Number(product.id)))
    .map((product) => [Number(product.id), product]),
);
for (const product of telegram.products) {
  const id = Number(product?.id);
  if (Number.isFinite(id) && product?.removed !== true && !removedIds.has(id)) {
    result.set(id, { ...(result.get(id) || {}), ...product, id });
  }
}

const products = [...result.values()];
const ids = products.map((product) => Number(product.id));
const removedLocal = localProducts.filter((product) =>
  removedIds.has(Number(product.id)),
).length;
const removalLimit = Math.max(5, Math.ceil(localProducts.length * 0.15));
if (removedLocal > removalLimit) {
  throw new Error(`Защитная остановка: найдено ${removedLocal} массовых удалений`);
}
if (new Set(ids).size !== ids.length) throw new Error("Обнаружены дубли ID");
if (products.some((product) => !["new", "used"].includes(product.condition))) {
  throw new Error("Есть карточки без раздела новые/б/у");
}

console.log(
  JSON.stringify({
    mode: "check",
    source: "https://t.me/nelli_leotards",
    before: localProducts.length,
    after: products.length,
    incomingIds: telegram.products.map((product) => Number(product.id)),
    removedIds: [...removedIds].sort((left, right) => left - right),
    removedLocal,
    unique: new Set(ids).size,
  }),
);