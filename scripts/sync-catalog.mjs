import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const siteDir = path.join(rootDir, "site");
const catalogFile = path.join(siteDir, "catalog-data.js");
const liveDataFile = path.join(siteDir, "api", "live-data.js");
const catalogAssetsDir = path.join(siteDir, "assets", "catalog");
const tempDir = path.join(rootDir, ".catalog-sync-tmp");
const backendUrl = new URL(
  process.env.NELLI_CATALOG_BACKEND ||
    "https://artnelli-leotards.aleksandr78ga.chatgpt.site/",
);

function extractJson(source, variableName) {
  const marker = `window.${variableName}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Не найдена переменная ${marker}`);
  }

  const equalsIndex = source.indexOf("=", markerIndex + marker.length);
  if (equalsIndex < 0) {
    throw new Error(`Не найдено значение ${marker}`);
  }

  let start = equalsIndex + 1;
  while (/\s/.test(source[start] || "")) start += 1;
  const opening = source[start];
  const closing = opening === "[" ? "]" : opening === "{" ? "}" : "";
  if (!closing) {
    throw new Error(`Значение ${marker} не является JSON`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }

  throw new Error(`Значение ${marker} оборвано`);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/javascript,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Leotards-by-Nelli-catalog-sync/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function localCatalogAsset(photo) {
  if (typeof photo !== "string" || !photo.startsWith("assets/catalog/")) {
    return null;
  }
  const absolutePath = path.resolve(siteDir, photo);
  const catalogPrefix = `${path.resolve(catalogAssetsDir)}${path.sep}`;
  return absolutePath.startsWith(catalogPrefix) ? absolutePath : null;
}

function imageExtension(contentType, remoteUrl, bytes) {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  const known = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  if (known[type]) return known[type];

  const pathname = new URL(remoteUrl).pathname.toLowerCase();
  const match = pathname.match(/\.(avif|gif|jpe?g|png|webp)$/);
  if (match) return match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;

  if (bytes?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return ".jpg";
  }
  if (
    bytes
      ?.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return ".png";
  }
  if (bytes?.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
    return ".gif";
  }
  if (
    bytes?.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes?.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  if (
    bytes?.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis"].includes(bytes?.subarray(8, 12).toString("ascii"))
  ) {
    return ".avif";
  }

  throw new Error(`Неизвестный формат изображения: ${contentType || remoteUrl}`);
}

async function downloadImage(remotePath, productId, photoIndex, existingNames) {
  const prefix = `telegram-${productId}-${String(photoIndex + 1).padStart(2, "0")}`;
  const existingName = existingNames.find((name) => name.startsWith(`${prefix}.`));
  if (existingName) return `assets/catalog/${existingName}`;

  const remoteUrl = new URL(remotePath, backendUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(remoteUrl, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "user-agent": "Leotards-by-Nelli-catalog-sync/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Фото ${photoIndex + 1} товара ${productId}: ${response.status} ${response.statusText}`,
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1_024) {
      throw new Error(`Фото ${photoIndex + 1} товара ${productId} слишком маленькое`);
    }

    const extension = imageExtension(
      response.headers.get("content-type"),
      remoteUrl,
      bytes,
    );
    const fileName = `${prefix}${extension}`;
    await writeFile(path.join(tempDir, fileName), bytes);
    return `assets/catalog/${fileName}`;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeProduct(product, photos) {
  return {
    ...product,
    id: Number(product.id),
    specs: product.specs || {},
    prices: Array.isArray(product.prices) ? product.prices : [],
    photos,
    sold: false,
    removed: false,
    available: true,
  };
}

function stableCatalogSource(products) {
  return `window.NELLI_CATALOG = ${JSON.stringify(products)};\n`;
}

function staticLiveDataSource() {
  const data = {
    generatedAt: null,
    telegram: {
      products: [],
      statuses: [],
      ok: true,
      publicFeed: true,
      source: "github",
    },
    instagram: {
      ok: false,
      connected: false,
      followersCount: null,
      media: [],
    },
  };
  return (
    `window.NELLI_LIVE=${JSON.stringify(data)};` +
    "window.dispatchEvent(new CustomEvent('nelli:live-data',{detail:window.NELLI_LIVE}));\n"
  );
}

async function main() {
  const localSource = await readFile(catalogFile, "utf8");
  const localProducts = extractJson(localSource, "NELLI_CATALOG");
  if (!Array.isArray(localProducts)) {
    throw new Error("Локальный каталог повреждён");
  }

  const liveUrl = new URL("/api/live-data.js", backendUrl);
  liveUrl.searchParams.set("catalog_sync", String(Date.now()));
  const liveSource = await fetchText(liveUrl);
  const liveData = extractJson(liveSource, "NELLI_LIVE");
  const telegram = liveData?.telegram;
  if (!telegram || telegram.ok !== true || !Array.isArray(telegram.products)) {
    throw new Error("Сервер синхронизации Telegram вернул неполные данные");
  }

  const removedIds = new Set(
    (telegram.statuses || [])
      .filter((status) => status?.removed === true)
      .map((status) => Number(status.id)),
  );
  for (const product of telegram.products) {
    const id = Number(product?.id);
    if (product?.removed === true && Number.isFinite(id)) removedIds.add(id);
  }

  const productById = new Map(
    localProducts
      .filter((product) => !removedIds.has(Number(product.id)))
      .map((product) => [Number(product.id), product]),
  );

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(catalogAssetsDir, { recursive: true });
  const existingNames = await readdir(catalogAssetsDir);

  let added = 0;
  let updated = 0;
  for (const incoming of telegram.products) {
    const id = Number(incoming?.id);
    if (!Number.isFinite(id) || incoming?.removed === true || removedIds.has(id)) {
      continue;
    }

    const existing = productById.get(id);
    let photos = Array.isArray(existing?.photos) ? existing.photos : [];
    const hasLocalPhotos =
      photos.length > 0 &&
      photos.every((photo) => typeof photo === "string" && !photo.startsWith("/api/"));

    if (!hasLocalPhotos) {
      const incomingPhotos = Array.isArray(incoming.photos) ? incoming.photos : [];
      if (incomingPhotos.length === 0) {
        throw new Error(`У товара ${id} нет фотографий`);
      }
      photos = await Promise.all(
        incomingPhotos.map((photo, index) =>
          downloadImage(photo, id, index, existingNames),
        ),
      );
    }

    productById.set(
      id,
      normalizeProduct(
        {
          ...(existing || {}),
          ...incoming,
        },
        photos,
      ),
    );
    if (existing) updated += 1;
    else added += 1;
  }

  const products = [...productById.values()].sort((left, right) => {
    const dateOrder = String(left.date || "").localeCompare(String(right.date || ""));
    return dateOrder || Number(left.id) - Number(right.id);
  });

  for (const fileName of await readdir(tempDir)) {
    await rename(path.join(tempDir, fileName), path.join(catalogAssetsDir, fileName));
  }
  await rm(tempDir, { recursive: true, force: true });

  const referencedAssets = new Set(
    products.flatMap((product) =>
      (product.photos || []).map(localCatalogAsset).filter(Boolean),
    ),
  );
  let removedAssets = 0;
  for (const product of localProducts.filter((item) =>
    removedIds.has(Number(item.id)),
  )) {
    for (const photo of product.photos || []) {
      const assetPath = localCatalogAsset(photo);
      if (assetPath && !referencedAssets.has(assetPath) && (await fileExists(assetPath))) {
        await rm(assetPath);
        removedAssets += 1;
      }
    }
  }

  const nextCatalogSource = stableCatalogSource(products);
  if (nextCatalogSource !== localSource) {
    await writeFile(catalogFile, nextCatalogSource);
  }

  const nextLiveDataSource = staticLiveDataSource();
  const currentLiveDataSource = (await fileExists(liveDataFile))
    ? await readFile(liveDataFile, "utf8")
    : "";
  if (currentLiveDataSource !== nextLiveDataSource) {
    await mkdir(path.dirname(liveDataFile), { recursive: true });
    await writeFile(liveDataFile, nextLiveDataSource);
  }

  console.log(
    `Каталог синхронизирован: ${products.length} карточек, добавлено ${added}, обновлено ${updated}, удалено ${removedIds.size}, удалено фото ${removedAssets}.`,
  );
}

main().catch(async (error) => {
  await rm(tempDir, { recursive: true, force: true });
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
