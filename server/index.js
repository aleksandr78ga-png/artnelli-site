import staticCatalogIds from "./catalog-ids.js";

const TELEGRAM_CHANNEL = "nelli_leotards";
const TELEGRAM_PUBLIC_URL = "https://t.me/s/" + TELEGRAM_CHANNEL;
const TELEGRAM_TOPIC_IDS = [2];
const TELEGRAM_ALLOWED_UPDATES = [
  "channel_post",
  "edited_channel_post",
  "message",
  "edited_message",
];
const TELEGRAM_WEBHOOK_MODE_VERSION = "forum-topics-v1";
const CACHE_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_HEALTH_TTL_MS = 5 * 60 * 1000;
const TELEGRAM_RECONCILE_BATCH = 12;

let liveCache = { expiresAt: 0, payload: null };
let telegramHealthCache = { expiresAt: 0, payload: null };
let databaseReady = null;

async function ensureDatabase(env) {
  if (!env.DB) return false;
  if (!databaseReady) {
    databaseReady = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_messages (
          message_id INTEGER PRIMARY KEY,
          media_group_id TEXT,
          raw_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_product_state (
          product_id INTEGER PRIMARY KEY,
          removed INTEGER NOT NULL DEFAULT 0,
          checked_at TEXT,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_product_snapshots (
          product_id INTEGER PRIMARY KEY,
          product_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS site_analytics (
          day TEXT NOT NULL,
          path TEXT NOT NULL,
          event TEXT NOT NULL,
          source TEXT NOT NULL,
          country TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, path, event, source, country)
        )
      `),
    ]).then(() => true).catch(() => {
      databaseReady = null;
      return false;
    });
  }
  return databaseReady;
}

async function saveTelegramUpdates(updates, env) {
  if (!(await ensureDatabase(env))) return 0;
  const statements = [];
  const now = new Date().toISOString();

  for (const update of Array.isArray(updates) ? updates : []) {
    const message = telegramUpdateMessage(update);
    if (!message || !isNelliChannelMessage(message)) continue;
    const messageId = Number(message.message_id);
    if (!Number.isFinite(messageId)) continue;
    statements.push(
      env.DB.prepare(`
        INSERT INTO telegram_messages
          (message_id, media_group_id, raw_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
          media_group_id = excluded.media_group_id,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at
      `).bind(
        messageId,
        message.media_group_id ? String(message.media_group_id) : null,
        JSON.stringify(message),
        now,
      ),
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
    liveCache = { expiresAt: 0, payload: null };
  }
  return statements.length;
}

async function saveTelegramProductSnapshots(products, env) {
  if (!(await ensureDatabase(env))) return 0;
  const now = new Date().toISOString();
  const statements = (Array.isArray(products) ? products : [])
    .filter((product) => Number.isFinite(Number(product?.id)))
    .map((product) =>
      env.DB.prepare(`
        INSERT INTO telegram_product_snapshots
          (product_id, product_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          product_json = excluded.product_json,
          updated_at = excluded.updated_at
      `).bind(Number(product.id), JSON.stringify(product), now),
    );
  if (statements.length) {
    await env.DB.batch(statements);
    liveCache = { expiresAt: 0, payload: null };
  }
  return statements.length;
}

async function deleteTelegramProductSnapshots(productIds, env) {
  if (!(await ensureDatabase(env))) return 0;
  const ids = [...new Set(
    (Array.isArray(productIds) ? productIds : [])
      .map(Number)
      .filter(Number.isFinite),
  )];
  if (!ids.length) return 0;
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        "DELETE FROM telegram_product_snapshots WHERE product_id = ?",
      ).bind(id),
    ),
  );
  liveCache = { expiresAt: 0, payload: null };
  return ids.length;
}

async function storedTelegramData(env) {
  if (!(await ensureDatabase(env))) {
    return { products: [], statuses: [], ok: false, storedMessages: 0 };
  }
  const [messageResult, snapshotResult] = await Promise.all([
    env.DB.prepare(
      "SELECT raw_json FROM telegram_messages ORDER BY message_id ASC",
    ).all(),
    env.DB.prepare(
      "SELECT product_json FROM telegram_product_snapshots ORDER BY product_id ASC",
    ).all(),
  ]);
  const updates = (messageResult.results || []).flatMap((row) => {
    try {
      return [{ message: JSON.parse(row.raw_json) }];
    } catch (error) {
      return [];
    }
  });
  const parsed = parseTelegramBotUpdates(updates);
  const snapshots = (snapshotResult.results || []).flatMap((row) => {
    try {
      return [JSON.parse(row.product_json)];
    } catch (error) {
      return [];
    }
  });
  const productMap = new Map(
    [...snapshots, ...parsed.products].map((product) => [
      Number(product.id),
      product,
    ]),
  );
  return {
    ...parsed,
    products: [...productMap.values()],
    ok: true,
    storedMessages: updates.length,
    storedSnapshots: snapshots.length,
  };
}

async function readSyncValue(env, key, fallback = "") {
  if (!(await ensureDatabase(env))) return fallback;
  const row = await env.DB.prepare(
    "SELECT value FROM telegram_sync_state WHERE key = ?",
  ).bind(key).first();
  return row?.value ?? fallback;
}

async function writeSyncValue(env, key, value) {
  if (!(await ensureDatabase(env))) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO telegram_sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind(key, String(value), now).run();
}

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };

  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function plainText(html = "") {
  return decodeHtml(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizedName(value = "") {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const CYRILLIC_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterateName(value = "") {
  return [...String(value)].map((character) => {
    const lower = character.toLocaleLowerCase("ru");
    const replacement = CYRILLIC_TO_LATIN[lower];
    if (replacement === undefined) return character;
    return character === lower
      ? replacement
      : replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }).join("");
}

function quotedName(text = "") {
  const patterns = [
    /[«“"]([^»”"\n]{2,90})[»”"]/u,
    /(?:купальник|платье|комбинезон)[^“«"\n]{0,60}\s+([A-ZА-ЯЁ][^\n]{2,60})/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim().replace(/[.!✅❤️]+$/u, "").trim();
  }

  return "";
}

function rangeValue(text, label) {
  const pattern = new RegExp(
    label + "\\s*[:—-]?\\s*([0-9]{2,3}(?:\\s*[-–—]\\s*[0-9]{2,3}|\\s*\\+)?)",
    "iu",
  );
  const match = text.match(pattern);
  return match ? match[1].replace(/\s/g, "").replace(/[–—]/g, "-") : "";
}

function priceValues(text) {
  const values = [];
  const pattern = /([0-9][0-9 .]{3,})\s*(?:руб(?:лей|ля|ль)?|₽)/giu;
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1].replace(/[ .]/g, ""));
    if (Number.isFinite(number) && number >= 1000 && !values.includes(number)) {
      values.push(number);
    }
  }
  return values;
}

function telegramTextStatus(text = "") {
  const removed = /(?:снят(?:о|а|ы)?\s+(?:с\s+публикации|с\s+продажи)|не\s+прода[её]тся|removed|withdrawn)/iu.test(
    text,
  );
  return { removed };
}

function isProductListing(text = "") {
  const garment = /купальник|леотард|платье|комбинезон|rhythmic\s+gymnastics|figure\s+skat/iu.test(
    text,
  );
  const measurements = /(?:^|\n|\s)(?:рост|ог|от|об|дуга\s+тела)\s*[:—-]?\s*[0-9]{2,3}/imu.test(
    text,
  );
  return garment && measurements;
}

function englishDescription(product) {
  const type = {
    leotard: "rhythmic gymnastics leotard",
    dress: "figure skating dress",
    jumpsuit: "competition jumpsuit",
  }[product.type] || "competition costume";
  const lines = [
    "For sale",
    (product.condition === "used" ? "Pre-owned " : "New ") +
      type +
      ((product.nameEn || product.name) ? " “" + (product.nameEn || product.name) + "”" : ""),
  ];
  if (product.height) lines.push("Height: " + product.height + " cm");
  if (product.specs.chest) lines.push("Chest: " + product.specs.chest + " cm");
  if (product.specs.waist) lines.push("Waist: " + product.specs.waist + " cm");
  if (product.specs.hips) lines.push("Hips: " + product.specs.hips + " cm");
  if (product.specs.girth) lines.push("Body girth: " + product.specs.girth + " cm");
  lines.push("Open the Telegram listing for current details.");
  return lines.join("\n");
}

export function parseTelegramPage(html) {
  const source = String(html);
  const splitChunks = source.split(
    /<div class="tgme_widget_message_wrap[^>]*>/i,
  );
  const chunks =
    splitChunks.length > 1
      ? splitChunks.slice(1)
      : source.includes('data-post="' + TELEGRAM_CHANNEL + "/")
        ? [source]
        : [];
  const products = [];
  const statuses = [];

  for (const chunk of chunks) {
    const idMatch = chunk.match(
      new RegExp('data-post="' + TELEGRAM_CHANNEL + '/([0-9]+)"', "i"),
    );
    if (!idMatch) continue;

    const id = Number(idMatch[1]);
    const textMatch = chunk.match(
      /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i,
    );
    const text = plainText(textMatch?.[1] || "");
    if (!text) continue;

    const name = quotedName(text) || "Модель №" + id;
    const { removed } = telegramTextStatus(text);

    if (removed) {
      statuses.push({
        id,
        name,
        normalizedName: normalizedName(name),
        sold: false,
        removed,
      });
    }

    if (!isProductListing(text) || removed) continue;

    const decodedChunk = decodeHtml(chunk);
    const photos = [];
    const photoPattern = /background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/gi;
    for (const photoMatch of decodedChunk.matchAll(photoPattern)) {
      if (/^https:\/\//i.test(photoMatch[1]) && !photos.includes(photoMatch[1])) {
        photos.push(photoMatch[1]);
      }
    }

    if (photos.length === 0) {
      const posterPattern = /(?:poster|src)=["'](https:\/\/[^"']+)["']/gi;
      for (const posterMatch of decodedChunk.matchAll(posterPattern)) {
        if (
          /\.(?:jpe?g|webp|png)(?:\?|$)/i.test(posterMatch[1]) &&
          !photos.includes(posterMatch[1])
        ) {
          photos.push(posterMatch[1]);
        }
      }
    }

    if (photos.length === 0) continue;

    const dateMatch = chunk.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const type = /платье|фигурн/iu.test(text)
      ? "dress"
      : /комбинезон/iu.test(text)
        ? "jumpsuit"
        : "leotard";
    const condition = /(?:^|\s)б\s*\/\s*у(?:$|\s|,)|pre-owned/iu.test(text)
      ? "used"
      : "new";
    const product = {
      id,
      name,
      nameEn: transliterateName(name),
      type,
      condition,
      sold: false,
      removed: false,
      available: true,
      date: dateMatch
        ? new Date(dateMatch[1]).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      height: rangeValue(text, "Рост"),
      specs: {
        chest: rangeValue(text, "ОГ"),
        waist: rangeValue(text, "ОТ"),
        hips: rangeValue(text, "ОБ"),
        girth: rangeValue(text, "Дуга\\s+тела"),
      },
      prices: priceValues(text),
      description: text,
      photos: photos.map(telegramPublicMediaUrl),
      telegram: "https://t.me/" + TELEGRAM_CHANNEL + "/" + id,
    };
    product.descriptionEn = englishDescription(product);
    products.push(product);
    statuses.push({
      id,
      name,
      normalizedName: normalizedName(name),
      sold: false,
      removed: false,
    });
  }

  return { products, statuses };
}

function isNelliChannelMessage(message) {
  const username = String(message?.chat?.username || "")
    .replace(/^@/, "")
    .toLocaleLowerCase("en");
  return username === TELEGRAM_CHANNEL;
}

function telegramUpdateMessage(update) {
  return (
    update?.edited_channel_post ||
    update?.channel_post ||
    update?.edited_message ||
    update?.message ||
    null
  );
}

function messageText(message) {
  return String(message?.caption || message?.text || "").trim();
}

function messageMediaFileId(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  if (photos.length) return photos.at(-1)?.file_id || "";
  return (
    message?.video?.thumbnail?.file_id ||
    message?.animation?.thumbnail?.file_id ||
    message?.document?.thumbnail?.file_id ||
    ""
  );
}

function telegramMediaUrl(fileId) {
  return "/api/telegram-media/" + encodeURIComponent(fileId);
}

function telegramPublicMediaUrl(sourceUrl) {
  return (
    "/api/telegram-public-media?url=" +
    encodeURIComponent(String(sourceUrl || ""))
  );
}

export function parseTelegramBotUpdates(updates) {
  const messagesById = new Map();

  for (const update of Array.isArray(updates) ? updates : []) {
    const message = telegramUpdateMessage(update);
    if (!message || !isNelliChannelMessage(message)) continue;
    messagesById.set(Number(message.message_id), message);
  }

  const groups = new Map();
  for (const message of messagesById.values()) {
    const key = message.media_group_id
      ? "media:" + message.media_group_id
      : "message:" + message.message_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(message);
  }

  const products = [];
  const statuses = [];

  for (const messages of groups.values()) {
    messages.sort((a, b) => Number(a.message_id) - Number(b.message_id));
    const primary = messages.find((message) => messageText(message)) || messages[0];
    const text = messageText(primary);
    if (!text) continue;

    const id = Number(primary.message_id);
    const name = quotedName(text) || "Модель №" + id;
    const { removed } = telegramTextStatus(text);

    if (removed) {
      statuses.push({
        id,
        name,
        normalizedName: normalizedName(name),
        sold: false,
        removed,
      });
    }

    if (!isProductListing(text) || removed) continue;

    const photos = messages
      .map(messageMediaFileId)
      .filter(Boolean)
      .filter((fileId, index, values) => values.indexOf(fileId) === index)
      .map(telegramMediaUrl);
    if (!photos.length) continue;

    const type = /платье|фигурн/iu.test(text)
      ? "dress"
      : /комбинезон/iu.test(text)
        ? "jumpsuit"
        : "leotard";
    const condition = /(?:^|\s)б\s*\/\s*у(?:$|\s|,)|pre-owned/iu.test(text)
      ? "used"
      : "new";
    const product = {
      id,
      name,
      nameEn: transliterateName(name),
      type,
      condition,
      sold: false,
      removed: false,
      available: true,
      date: new Date(Number(primary.date || 0) * 1000)
        .toISOString()
        .slice(0, 10),
      height: rangeValue(text, "Рост"),
      specs: {
        chest: rangeValue(text, "ОГ"),
        waist: rangeValue(text, "ОТ"),
        hips: rangeValue(text, "ОБ"),
        girth: rangeValue(text, "Дуга\\s+тела"),
      },
      prices: priceValues(text),
      description: text,
      photos,
      telegram: "https://t.me/" + TELEGRAM_CHANNEL + "/" + id,
    };
    product.descriptionEn = englishDescription(product);
    products.push(product);
    statuses.push({
      id,
      name,
      normalizedName: normalizedName(name),
      sold: false,
      removed: false,
    });
  }

  return { products, statuses };
}

function mergeTelegramResults(...results) {
  const productMap = new Map();
  const statusMap = new Map();

  for (const result of results) {
    for (const product of result?.products || []) {
      productMap.set(Number(product.id), product);
    }
    for (const status of result?.statuses || []) {
      const key = Number(status.id) || status.normalizedName;
      if (key) statusMap.set(key, status);
    }
  }

  return {
    products: [...productMap.values()],
    statuses: [...statusMap.values()],
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function telegramApi(token, method, payload = {}) {
  const response = await fetchWithTimeout(
    "https://api.telegram.org/bot" + token + "/" + method,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    10000,
  );
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error("Telegram " + method + " failed");
  }
  return body.result;
}

async function bootstrapTelegramWebhook(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookUrl || !webhookSecret) {
    return { configured: false, active: false, importedUpdates: 0 };
  }

  const lastBootstrap = Number(
    await readSyncValue(env, "webhook_checked_at", "0"),
  );
  const lastWebhookUrl = await readSyncValue(env, "webhook_url", "");
  const lastWebhookMode = await readSyncValue(env, "webhook_mode_version", "");
  if (
    lastWebhookUrl === webhookUrl &&
    lastWebhookMode === TELEGRAM_WEBHOOK_MODE_VERSION &&
    Date.now() - lastBootstrap < 5 * 60 * 1000
  ) {
    return { configured: true, active: true, importedUpdates: 0 };
  }

  try {
    const info = await telegramApi(token, "getWebhookInfo");
    let importedUpdates = 0;

    if (!info?.url) {
      const updates = await telegramApi(token, "getUpdates", {
        limit: 100,
        timeout: 0,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      });
      importedUpdates = await saveTelegramUpdates(updates, env);
      const lastUpdateId = Math.max(
        0,
        ...(Array.isArray(updates)
          ? updates.map((update) => Number(update.update_id) || 0)
          : []),
      );
      if (lastUpdateId) {
        await telegramApi(token, "getUpdates", {
          offset: lastUpdateId + 1,
          limit: 1,
          timeout: 0,
        });
      }
    }

    const configuredUpdates = new Set(
      Array.isArray(info?.allowed_updates) ? info.allowed_updates : [],
    );
    const missingTopicUpdates = TELEGRAM_ALLOWED_UPDATES.some(
      (updateType) => !configuredUpdates.has(updateType),
    );
    if (info?.url !== webhookUrl || missingTopicUpdates) {
      await telegramApi(token, "setWebhook", {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
        drop_pending_updates: false,
      });
    }

    await writeSyncValue(env, "webhook_checked_at", Date.now());
    await writeSyncValue(env, "webhook_url", webhookUrl);
    await writeSyncValue(
      env,
      "webhook_mode_version",
      TELEGRAM_WEBHOOK_MODE_VERSION,
    );
    return { configured: true, active: true, importedUpdates };
  } catch (error) {
    return { configured: true, active: false, importedUpdates: 0 };
  }
}

async function telegramWebhookInfoSafe(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { configured: false };
  try {
    const info = await telegramApi(token, "getWebhookInfo");
    return {
      configured: true,
      url: info?.url || "",
      pendingUpdateCount: Number(info?.pending_update_count || 0),
      lastErrorDate: info?.last_error_date
        ? new Date(Number(info.last_error_date) * 1000).toISOString()
        : null,
      lastErrorMessage: info?.last_error_message || null,
      allowedUpdates: Array.isArray(info?.allowed_updates)
        ? info.allowed_updates
        : [],
    };
  } catch (error) {
    return { configured: true, unavailable: true };
  }
}

function explicitMissingTelegramPost(html = "", status = 200) {
  if (status === 404 || status === 410) return true;
  return /(?:tgme_widget_message_error|message\s+(?:was\s+)?deleted|post\s+not\s+found|message\s+not\s+found|публикаци[яию]\s+не\s+найдена|сообщение\s+удалено)/iu.test(
    html,
  );
}

async function telegramPostDocument(id) {
  try {
    const response = await fetchWithTimeout(
      "https://t.me/" +
        TELEGRAM_CHANNEL +
        "/" +
        encodeURIComponent(id) +
        "?embed=1&mode=tme",
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "ru,en;q=0.8",
          "user-agent": "Mozilla/5.0 (compatible; ArtNelliCatalog/2.0)",
        },
      },
      8000,
    );
    const html = await response.text();
    if (
      html.includes('data-post="' + TELEGRAM_CHANNEL + "/" + id + '"') ||
      html.includes('data-post="' + TELEGRAM_CHANNEL + "%2F" + id + '"')
    ) {
      return { state: "exists", html };
    }
    return {
      state: explicitMissingTelegramPost(html, response.status)
        ? "missing"
        : "unknown",
      html,
    };
  } catch (error) {
    return { state: "unknown", html: "" };
  }
}

async function telegramPostState(id) {
  return (await telegramPostDocument(id)).state;
}

async function scanTelegramPublicProducts(env) {
  if (!(await ensureDatabase(env))) {
    return { checked: 0, found: 0, saved: 0, from: null, next: null };
  }

  const firstDynamicId = Math.max(0, ...staticCatalogIds) + 1;
  const storedCursor = Number(
    await readSyncValue(env, "public_scan_cursor", String(firstDynamicId)),
  );
  const cursor = Math.max(firstDynamicId, storedCursor || firstDynamicId);
  const from = Math.max(firstDynamicId, cursor - 8);
  const ids = Array.from({ length: 32 }, (_, index) => from + index);
  const documents = await Promise.all(
    ids.map(async (id) => ({ id, ...(await telegramPostDocument(id)) })),
  );
  let lastExistingId = from - 1;
  const products = [];

  for (const document of documents) {
    if (document.state !== "exists") continue;
    lastExistingId = Math.max(lastExistingId, document.id);
    const parsed = parseTelegramPage(document.html);
    for (const product of parsed.products) {
      if (!products.some((item) => Number(item.id) === Number(product.id))) {
        products.push(product);
      }
    }
  }

  const albumProducts = [];
  const lastAlbumByDescription = new Map();
  const albumDuplicates = [];
  for (const product of products.sort((a, b) => Number(a.id) - Number(b.id))) {
    const albumKey = String(product.description || "")
      .replace(/\s+/g, " ")
      .trim();
    const existingAlbum = lastAlbumByDescription.get(albumKey);
    if (
      existingAlbum &&
      Number(product.id) - Number(existingAlbum.id) <= 10
    ) {
      albumDuplicates.push(Number(product.id));
      continue;
    }
    albumProducts.push(product);
    lastAlbumByDescription.set(albumKey, product);
  }
  const canonicalProducts = albumProducts;
  const saved = await saveTelegramProductSnapshots(canonicalProducts, env);
  const duplicatesRemoved = await deleteTelegramProductSnapshots(
    albumDuplicates,
    env,
  );
  const next = Math.max(
    cursor,
    lastExistingId >= from ? lastExistingId + 1 : from,
    from + Math.max(1, ids.length - 8),
  );
  await writeSyncValue(env, "public_scan_cursor", next);
  return {
    checked: documents.filter((document) => document.state !== "unknown").length,
    existing: documents.filter((document) => document.state === "exists").length,
    found: canonicalProducts.length,
    saved,
    albumDuplicates: albumDuplicates.length,
    duplicatesRemoved,
    from,
    next,
  };
}

function telegramPageMessageIds(html = "") {
  const ids = [];
  const pattern = new RegExp(
    'data-post="' + TELEGRAM_CHANNEL + '/([0-9]+)"',
    "gi",
  );
  for (const match of String(html).matchAll(pattern)) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function telegramTopicPage(topicId) {
  const urls = [
    TELEGRAM_PUBLIC_URL + "/" + encodeURIComponent(topicId),
    TELEGRAM_PUBLIC_URL + "?thread=" + encodeURIComponent(topicId),
  ];
  const documents = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetchWithTimeout(
          url,
          {
            headers: {
              accept: "text/html,application/xhtml+xml",
              "accept-language": "ru,en;q=0.8",
              "user-agent": "Mozilla/5.0 (compatible; ArtNelliCatalog/3.0)",
            },
          },
          10000,
        );
        if (!response.ok) {
          return { ok: false, html: "", messageIds: [], parsed: null };
        }
        const html = await response.text();
        return {
          ok: true,
          html,
          messageIds: telegramPageMessageIds(html),
          parsed: parseTelegramPage(html),
        };
      } catch (error) {
        return { ok: false, html: "", messageIds: [], parsed: null };
      }
    }),
  );
  return documents.sort((left, right) => {
    const leftScore =
      left.messageIds.length + (left.parsed?.products?.length || 0) * 10;
    const rightScore =
      right.messageIds.length + (right.parsed?.products?.length || 0) * 10;
    return rightScore - leftScore;
  })[0];
}

async function scanTelegramTopicProducts(env) {
  if (!(await ensureDatabase(env))) {
    return { checked: 0, found: 0, saved: 0, topics: [] };
  }

  const topicDocuments = await Promise.all(
    TELEGRAM_TOPIC_IDS.map(async (topicId) => ({
      topicId,
      ...(await telegramTopicPage(topicId)),
    })),
  );
  const staticIds = new Set(staticCatalogIds.map(Number));
  const productMap = new Map();

  for (const document of topicDocuments) {
    for (const product of document.parsed?.products || []) {
      if (!staticIds.has(Number(product.id))) {
        productMap.set(Number(product.id), product);
      }
    }
  }

  const products = [...productMap.values()].sort(
    (left, right) => Number(left.id) - Number(right.id),
  );
  const canonicalProducts = [];
  const albumDuplicates = [];
  const lastAlbumByDescription = new Map();
  for (const product of products) {
    const albumKey = String(product.description || "")
      .replace(/\s+/g, " ")
      .trim();
    const existingAlbum = lastAlbumByDescription.get(albumKey);
    if (
      existingAlbum &&
      Number(product.id) - Number(existingAlbum.id) <= 10
    ) {
      albumDuplicates.push(Number(product.id));
      continue;
    }
    canonicalProducts.push(product);
    lastAlbumByDescription.set(albumKey, product);
  }

  const saved = await saveTelegramProductSnapshots(canonicalProducts, env);
  const duplicatesRemoved = await deleteTelegramProductSnapshots(
    albumDuplicates,
    env,
  );
  return {
    checked: topicDocuments.filter((document) => document.ok).length,
    found: canonicalProducts.length,
    saved,
    albumDuplicates: albumDuplicates.length,
    duplicatesRemoved,
    products: canonicalProducts.map((product) => ({
      id: Number(product.id),
      name: product.name,
    })),
    topics: topicDocuments.map((document) => ({
      topicId: document.topicId,
      ok: document.ok,
      messages: document.messageIds.length,
      products: document.parsed?.products?.length || 0,
    })),
  };
}

async function reconcileTelegramDeletions(env, storedProducts = []) {
  if (!(await ensureDatabase(env))) return { checked: 0, removed: 0 };

  const allIds = [...new Set([
    ...staticCatalogIds,
    ...storedProducts.map((product) => Number(product.id)),
  ].filter(Number.isFinite))].sort((a, b) => b - a);
  if (!allIds.length) return { checked: 0, removed: 0 };

  const cursor = Number(await readSyncValue(env, "reconcile_cursor", "0")) || 0;
  const batch = Array.from(
    { length: Math.min(TELEGRAM_RECONCILE_BATCH, allIds.length) },
    (_, index) => allIds[(cursor + index) % allIds.length],
  );
  const results = await Promise.all(
    batch.map(async (id) => ({ id, state: await telegramPostState(id) })),
  );
  const now = new Date().toISOString();
  const statements = results
    .filter((result) => result.state !== "unknown")
    .map(({ id, state }) =>
      env.DB.prepare(`
        INSERT INTO telegram_product_state
          (product_id, removed, checked_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          removed = excluded.removed,
          checked_at = excluded.checked_at,
          updated_at = excluded.updated_at
      `).bind(id, state === "missing" ? 1 : 0, now, now),
    );
  if (statements.length) await env.DB.batch(statements);
  await writeSyncValue(
    env,
    "reconcile_cursor",
    (cursor + batch.length) % allIds.length,
  );
  return {
    checked: results.filter((result) => result.state !== "unknown").length,
    removed: results.filter((result) => result.state === "missing").length,
  };
}

async function storedRemovalStatuses(env) {
  if (!(await ensureDatabase(env))) return [];
  const result = await env.DB.prepare(
    "SELECT product_id FROM telegram_product_state WHERE removed = 1",
  ).all();
  return (result.results || []).map((row) => ({
    id: Number(row.product_id),
    normalizedName: "",
    sold: false,
    removed: true,
  }));
}

async function telegramPublicData() {
  try {
    const response = await fetchWithTimeout(TELEGRAM_PUBLIC_URL, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; ArtNelliCatalog/1.0)",
      },
    });
    if (!response.ok) throw new Error("Telegram HTTP " + response.status);
    const parsed = parseTelegramPage(await response.text());
    return { ...parsed, ok: true };
  } catch (error) {
    return { products: [], statuses: [], ok: false };
  }
}

async function telegramPublicRecent() {
  try {
    const response = await fetchWithTimeout(TELEGRAM_PUBLIC_URL, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; ArtNelliCatalog/2.0)",
      },
    });
    if (!response.ok) throw new Error("Telegram HTTP " + response.status);
    const html = await response.text();
    return String(html)
      .split(/<div class="tgme_widget_message_wrap[^>]*>/i)
      .slice(1)
      .map((chunk) => {
        const idMatch = chunk.match(
          new RegExp('data-post="' + TELEGRAM_CHANNEL + '/([0-9]+)"', "i"),
        );
        const textMatch = chunk.match(
          /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i,
        );
        const dateMatch = chunk.match(/<time[^>]+datetime=["']([^"']+)["']/i);
        const text = plainText(textMatch?.[1] || "");
        if (!idMatch) return null;
        return {
          id: Number(idMatch[1]),
          date: dateMatch?.[1] || null,
          text: text.slice(0, 1200),
          productLike: isProductListing(text),
        };
      })
      .filter(Boolean)
      .slice(-12);
  } catch (error) {
    return [];
  }
}

async function telegramBotData(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      products: [],
      statuses: [],
      ok: false,
      connected: false,
      pendingUpdates: 0,
    };
  }

  const url = new URL("https://api.telegram.org/bot" + token + "/getUpdates");
  url.searchParams.set("limit", "100");
  url.searchParams.set("timeout", "0");
  url.searchParams.set(
    "allowed_updates",
    JSON.stringify(["channel_post", "edited_channel_post", "message"]),
  );

  try {
    const response = await fetchWithTimeout(url, {}, 8000);
    if (!response.ok) throw new Error("Telegram Bot HTTP " + response.status);
    const body = await response.json();
    if (!body.ok) throw new Error("Telegram Bot API error");
    const updates = Array.isArray(body.result) ? body.result : [];
    const parsed = parseTelegramBotUpdates(updates);
    return {
      ...parsed,
      ok: true,
      connected: true,
      pendingUpdates: updates.length,
    };
  } catch (error) {
    return {
      products: [],
      statuses: [],
      ok: false,
      connected: true,
      pendingUpdates: 0,
    };
  }
}

async function telegramConnectionStatus(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const checkedAt = new Date().toISOString();
  if (!token) {
    return {
      configured: false,
      authenticated: false,
      botUsername: null,
      channelUsername: TELEGRAM_CHANNEL,
      channelStatus: null,
      channelAdmin: false,
      checkedAt,
    };
  }

  if (
    telegramHealthCache.payload &&
    Date.now() < telegramHealthCache.expiresAt
  ) {
    return telegramHealthCache.payload;
  }

  let payload;
  try {
    const getMeResponse = await fetchWithTimeout(
      "https://api.telegram.org/bot" + token + "/getMe",
      {},
      8000,
    );
    const getMe = await getMeResponse.json();
    if (!getMeResponse.ok || !getMe.ok || !getMe.result?.id) {
      throw new Error("Telegram bot authentication failed");
    }

    let channelStatus = null;
    try {
      const memberUrl = new URL(
        "https://api.telegram.org/bot" + token + "/getChatMember",
      );
      memberUrl.searchParams.set("chat_id", "@" + TELEGRAM_CHANNEL);
      memberUrl.searchParams.set("user_id", String(getMe.result.id));
      const memberResponse = await fetchWithTimeout(memberUrl, {}, 8000);
      const member = await memberResponse.json();
      if (memberResponse.ok && member.ok) {
        channelStatus = member.result?.status || null;
      }
    } catch (error) {
      channelStatus = null;
    }

    payload = {
      configured: true,
      authenticated: true,
      botUsername: getMe.result.username || null,
      channelUsername: TELEGRAM_CHANNEL,
      channelStatus,
      channelAdmin: ["administrator", "creator"].includes(channelStatus),
      checkedAt,
    };
  } catch (error) {
    payload = {
      configured: true,
      authenticated: false,
      botUsername: null,
      channelUsername: TELEGRAM_CHANNEL,
      channelStatus: null,
      channelAdmin: false,
      checkedAt,
    };
  }

  telegramHealthCache = {
    payload,
    expiresAt: Date.now() + TELEGRAM_HEALTH_TTL_MS,
  };
  return payload;
}

async function telegramData(env) {
  const bootstrap = await bootstrapTelegramWebhook(env);
  const [publicData, publicScan, topicScan] = await Promise.all([
    telegramPublicData(),
    scanTelegramPublicProducts(env),
    scanTelegramTopicProducts(env),
  ]);
  const storedData = await storedTelegramData(env);
  const reconciliation = await reconcileTelegramDeletions(
    env,
    storedData.products,
  );
  const removalStatuses = await storedRemovalStatuses(env);
  const merged = mergeTelegramResults(
    publicData,
    storedData,
    { products: [], statuses: removalStatuses },
  );
  return {
    ...merged,
    ok: publicData.ok || storedData.ok,
    publicFeed: publicData.ok,
    botConnected: bootstrap.configured,
    webhookActive: bootstrap.active,
    importedUpdates: bootstrap.importedUpdates,
    storedMessages: storedData.storedMessages,
    storedSnapshots: storedData.storedSnapshots,
    publicScan,
    topicScan,
    reconciliation,
  };
}

async function instagramData(env) {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  const userId = env.INSTAGRAM_USER_ID;
  if (!token || !userId) {
    return {
      ok: false,
      connected: false,
      followersCount: null,
      media: [],
    };
  }

  const apiVersion = env.INSTAGRAM_API_VERSION || "v21.0";
  const graphBase = (env.INSTAGRAM_GRAPH_BASE || "https://graph.facebook.com")
    .replace(/\/+$/, "");
  const profileUrl = new URL(
    graphBase + "/" + apiVersion + "/" + encodeURIComponent(userId),
  );
  profileUrl.searchParams.set(
    "fields",
    "id,username,followers_count,media_count",
  );
  profileUrl.searchParams.set("access_token", token);

  try {
    const profileResponse = await fetchWithTimeout(profileUrl, {}, 8000);
    if (!profileResponse.ok) {
      throw new Error("Instagram HTTP " + profileResponse.status);
    }
    const profile = await profileResponse.json();
    let media = [];

    const portfolioStart = Date.parse(
      env.INSTAGRAM_AUTO_PORTFOLIO_START_DATE || "2026-07-16T00:00:00+05:00",
    );
    const autoPortfolioEnabled =
      env.INSTAGRAM_AUTO_PORTFOLIO !== "false" && Date.now() >= portfolioStart;

    if (autoPortfolioEnabled) {
      const mediaUrl = new URL(
        graphBase +
          "/" +
          apiVersion +
          "/" +
          encodeURIComponent(userId) +
          "/media",
      );
      mediaUrl.searchParams.set(
        "fields",
        "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
      );
      mediaUrl.searchParams.set("limit", "12");
      mediaUrl.searchParams.set("access_token", token);
      const mediaResponse = await fetchWithTimeout(mediaUrl, {}, 8000);
      if (mediaResponse.ok) {
        const body = await mediaResponse.json();
        const athletePost = /(гимнаст|спортсмен|сборн|выступ|соревн|чемпион|кубок|gymnast|athlete|national\s+team|competition|championship|world\s+cup|rhythmic|acrobat|figure\s+skat|performance|tournament)/iu;
        media = (body.data || [])
          .filter((item) => item.permalink && (item.media_url || item.thumbnail_url))
          .filter((item) => athletePost.test(item.caption || ""))
          .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
          .map((item) => ({
            id: item.id,
            caption: item.caption || "",
            mediaType: item.media_type,
            image: item.thumbnail_url || item.media_url,
            permalink: item.permalink,
            timestamp: item.timestamp,
          }));
      }
    }

    return {
      ok: true,
      connected: true,
      username: profile.username || "art_nelli_leotards",
      followersCount: profile.followers_count ?? null,
      mediaCount: profile.media_count ?? null,
      media,
    };
  } catch (error) {
    return {
      ok: false,
      connected: true,
      followersCount: null,
      media: [],
    };
  }
}

async function getLivePayload(env) {
  if (liveCache.payload && Date.now() < liveCache.expiresAt) {
    return liveCache.payload;
  }

  const [telegram, instagram] = await Promise.all([
    telegramData(env),
    instagramData(env),
  ]);
  const payload = {
    generatedAt: new Date().toISOString(),
    telegram,
    instagram,
  };
  liveCache = {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return payload;
}

function liveScript(payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return (
    "window.NELLI_LIVE=" +
    json +
    ";window.dispatchEvent(new CustomEvent('nelli:live-data',{detail:window.NELLI_LIVE}));"
  );
}

async function telegramMediaResponse(fileId, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{10,512}$/.test(fileId)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fileInfoResponse = await fetchWithTimeout(
      "https://api.telegram.org/bot" +
        token +
        "/getFile?file_id=" +
        encodeURIComponent(fileId),
      {},
      8000,
    );
    if (!fileInfoResponse.ok) throw new Error("Telegram getFile failed");
    const fileInfo = await fileInfoResponse.json();
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error("Telegram file path missing");
    }

    const fileResponse = await fetchWithTimeout(
      "https://api.telegram.org/file/bot" +
        token +
        "/" +
        fileInfo.result.file_path,
      {},
      12000,
    );
    if (!fileResponse.ok) throw new Error("Telegram file download failed");

    const headers = new Headers({
      "content-type": fileResponse.headers.get("content-type") || "image/jpeg",
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "x-content-type-options": "nosniff",
    });
    return new Response(fileResponse.body, { status: 200, headers });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}

async function telegramPublicMediaResponse(sourceUrl) {
  try {
    const source = new URL(String(sourceUrl || ""));
    if (
      source.protocol !== "https:" ||
      !/^(?:cdn[0-9]*\.)?telesco\.pe$/i.test(source.hostname) ||
      !source.pathname.startsWith("/file/")
    ) {
      throw new Error("Unsupported Telegram media URL");
    }
    const mediaResponse = await fetchWithTimeout(
      source,
      {
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
          "user-agent": "Mozilla/5.0 (compatible; ArtNelliCatalog/2.0)",
        },
      },
      12000,
    );
    const contentType =
      mediaResponse.headers.get("content-type") || "image/jpeg";
    if (!mediaResponse.ok || !contentType.startsWith("image/")) {
      throw new Error("Telegram media download failed");
    }
    return new Response(mediaResponse.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600, s-maxage=86400",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    return new Response("Not found", { status: 404 });
  }
}

const ANALYTICS_EVENTS = new Set([
  "pageview",
  "catalog_open",
  "tailoring_open",
  "booking_open",
  "booking_send",
  "telegram_open",
  "whatsapp_open",
  "measurement_download",
  "product_open",
]);

function analyticsText(value, fallback, maxLength) {
  const text = String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

async function collectAnalytics(request, env) {
  if (!(await ensureDatabase(env))) {
    return new Response(null, { status: 204 });
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return new Response("Bad request", { status: 400 });
  }

  const event = analyticsText(body?.event, "pageview", 48);
  if (!ANALYTICS_EVENTS.has(event)) {
    return new Response("Bad request", { status: 400 });
  }

  let path = analyticsText(body?.path, "/", 180);
  if (!path.startsWith("/")) path = "/";
  path = path.split("?")[0].split("#")[0] || "/";

  const source = analyticsText(body?.source, "direct", 48)
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9_-]/g, "") || "direct";
  const country = analyticsText(request.cf?.country, "—", 3)
    .toLocaleUpperCase("en")
    .replace(/[^A-Z-]/g, "") || "—";
  const day = new Date().toISOString().slice(0, 10);

  await env.DB.prepare(`
    INSERT INTO site_analytics (day, path, event, source, country, count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(day, path, event, source, country)
    DO UPDATE SET count = count + 1
  `).bind(day, path, event, source, country).run();

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function analyticsSummary(url, env) {
  const requestedDays = Number(url.searchParams.get("days") || 30);
  const days = Math.min(365, Math.max(1, Math.trunc(requestedDays) || 30));
  const since = new Date(Date.now() - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);

  if (!(await ensureDatabase(env))) {
    return {
      generatedAt: new Date().toISOString(),
      days,
      since,
      pageviews: 0,
      interactions: 0,
      today: 0,
      daily: [],
      pages: [],
      sources: [],
      events: [],
      countries: [],
    };
  }

  const [
    totals,
    today,
    daily,
    pages,
    sources,
    events,
    countries,
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN event = 'pageview' THEN count ELSE 0 END) AS pageviews,
        SUM(CASE WHEN event <> 'pageview' THEN count ELSE 0 END) AS interactions
      FROM site_analytics
      WHERE day >= ?
    `).bind(since).first(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(count), 0) AS value
      FROM site_analytics
      WHERE day = ? AND event = 'pageview'
    `).bind(new Date().toISOString().slice(0, 10)).first(),
    env.DB.prepare(`
      SELECT day, SUM(count) AS count
      FROM site_analytics
      WHERE day >= ? AND event = 'pageview'
      GROUP BY day
      ORDER BY day ASC
    `).bind(since).all(),
    env.DB.prepare(`
      SELECT path, SUM(count) AS count
      FROM site_analytics
      WHERE day >= ? AND event = 'pageview'
      GROUP BY path
      ORDER BY count DESC
      LIMIT 12
    `).bind(since).all(),
    env.DB.prepare(`
      SELECT source, SUM(count) AS count
      FROM site_analytics
      WHERE day >= ? AND event = 'pageview'
      GROUP BY source
      ORDER BY count DESC
      LIMIT 12
    `).bind(since).all(),
    env.DB.prepare(`
      SELECT event, SUM(count) AS count
      FROM site_analytics
      WHERE day >= ? AND event <> 'pageview'
      GROUP BY event
      ORDER BY count DESC
      LIMIT 12
    `).bind(since).all(),
    env.DB.prepare(`
      SELECT country, SUM(count) AS count
      FROM site_analytics
      WHERE day >= ? AND event = 'pageview'
      GROUP BY country
      ORDER BY count DESC
      LIMIT 12
    `).bind(since).all(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    days,
    since,
    pageviews: Number(totals?.pageviews || 0),
    interactions: Number(totals?.interactions || 0),
    today: Number(today?.value || 0),
    daily: daily.results || [],
    pages: pages.results || [],
    sources: sources.results || [],
    events: events.results || [],
    countries: countries.results || [],
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/api/analytics/collect" &&
      request.method === "POST"
    ) {
      return collectAnalytics(request, env);
    }

    if (url.pathname === "/api/statistics" && request.method === "GET") {
      const payload = await analyticsSummary(url, env);
      return new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-robots-tag": "noindex, nofollow",
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (
      url.pathname === "/api/telegram-webhook" &&
      request.method === "POST"
    ) {
      const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
      const receivedSecret = request.headers.get(
        "x-telegram-bot-api-secret-token",
      );
      if (!expectedSecret || receivedSecret !== expectedSecret) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const update = await request.json();
        await saveTelegramUpdates([update], env);
        return new Response("OK", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        return new Response("Bad request", { status: 400 });
      }
    }

    if (url.pathname === "/api/telegram-sync") {
      const bootstrap = await bootstrapTelegramWebhook(env);
      const [publicScan, topicScan] = await Promise.all([
        scanTelegramPublicProducts(env),
        scanTelegramTopicProducts(env),
      ]);
      const stored = await storedTelegramData(env);
      const reconciliation = await reconcileTelegramDeletions(
        env,
        stored.products,
      );
      const webhook = await telegramWebhookInfoSafe(env);
      return new Response(JSON.stringify({
        configured: bootstrap.configured,
        webhookActive: bootstrap.active,
        importedUpdates: bootstrap.importedUpdates,
        storedMessages: stored.storedMessages,
        storedSnapshots: stored.storedSnapshots,
        storedProducts: stored.products.length,
        publicScan,
        topicScan,
        reconciliation,
        webhook,
        checkedAt: new Date().toISOString(),
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/api/telegram-public-recent") {
      const messages = await telegramPublicRecent();
      return new Response(JSON.stringify({
        channel: TELEGRAM_CHANNEL,
        messages,
        checkedAt: new Date().toISOString(),
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-robots-tag": "noindex, nofollow",
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (
      url.pathname === "/api/telegram-status" ||
      url.pathname === "/telegram-status"
    ) {
      const payload = await telegramConnectionStatus(env);
      return new Response(JSON.stringify(payload), {
        headers: {
          "content-type":
            url.pathname === "/telegram-status"
              ? "text/plain; charset=utf-8"
              : "application/json; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (url.pathname.startsWith("/api/telegram-media/")) {
      const fileId = decodeURIComponent(
        url.pathname.slice("/api/telegram-media/".length),
      );
      return telegramMediaResponse(fileId, env);
    }

    if (
      url.pathname === "/api/telegram-public-media" &&
      request.method === "GET"
    ) {
      return telegramPublicMediaResponse(url.searchParams.get("url"));
    }

    if (url.pathname === "/api/live-data.js") {
      const payload = await getLivePayload(env);
      return new Response(liveScript(payload), {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300, s-maxage=900",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/") {
      url.pathname = "/index.html";
    } else if (url.pathname.endsWith("/")) {
      url.pathname += "index.html";
    }

    if (env.ASSETS?.fetch) {
      return env.ASSETS.fetch(new Request(url, request));
    }

    return new Response("Art Nelli static assets are unavailable.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
