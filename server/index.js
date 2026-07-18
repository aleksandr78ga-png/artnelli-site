const TELEGRAM_CHANNEL = "nelli_leotards";
const TELEGRAM_PUBLIC_URL = "https://t.me/s/" + TELEGRAM_CHANNEL;
const TELEGRAM_SETUP_PATH =
  "/telegram-connect-fd60b144ab4d68fd9511b558";
const TELEGRAM_VERIFY_PATH = "/ilon-check-fd60b144ab4d68fd9511b558.html";
const CACHE_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_HEALTH_TTL_MS = 5 * 60 * 1000;

let liveCache = { expiresAt: 0, payload: null };
let telegramHealthCache = { expiresAt: 0, payload: null };

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
  const sold = /(?:^|\s)(?:продан(?:о|а|ы)?|sold)(?:$|\s|[!.,✅❌])/imu.test(
    text,
  );
  const removed = /(?:снят(?:о|а|ы)?\s+(?:с\s+публикации|с\s+продажи)|не\s+прода[её]тся|removed|withdrawn)/iu.test(
    text,
  );
  const selling = /прода[её]тся|в\s+продаже|for\s+sale/iu.test(text);
  return { sold, removed, selling };
}

function englishDescription(product) {
  const type = {
    leotard: "rhythmic gymnastics leotard",
    dress: "figure skating dress",
    jumpsuit: "competition jumpsuit",
  }[product.type] || "competition costume";
  const lines = [
    product.sold ? "Sold" : "For sale",
    (product.condition === "used" ? "Pre-owned " : "New ") +
      type +
      ((product.nameEn || product.name) ? " “" + (product.nameEn || product.name) + "”" : ""),
  ];
  if (product.height) lines.push("Height: " + product.height + " cm");
  if (product.specs.chest) lines.push("Chest: " + product.specs.chest + " cm");
  if (product.specs.waist) lines.push("Waist: " + product.specs.waist + " cm");
  if (product.specs.hips) lines.push("Hips: " + product.specs.hips + " cm");
  if (product.specs.girth) lines.push("Body girth: " + product.specs.girth + " cm");
  if (!product.sold) lines.push("Open the Telegram listing for current details.");
  return lines.join("\n");
}

export function parseTelegramPage(html) {
  const chunks = String(html)
    .split(/<div class="tgme_widget_message_wrap[^>]*>/i)
    .slice(1);
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

    const name = quotedName(text);
    const { sold, removed, selling } = telegramTextStatus(text);

    if (name && (sold || removed)) {
      statuses.push({
        id,
        name,
        normalizedName: normalizedName(name),
        sold,
        removed,
      });
    }

    if ((!selling && !sold) || removed) continue;

    const decodedChunk = decodeHtml(chunk);
    const photos = [];
    const photoPattern = /background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/gi;
    for (const photoMatch of decodedChunk.matchAll(photoPattern)) {
      if (/^https:\/\//i.test(photoMatch[1]) && !photos.includes(photoMatch[1])) {
        photos.push(photoMatch[1]);
      }
    }

    const posterPattern = /(?:poster|src)=["'](https:\/\/[^"']+)["']/gi;
    for (const posterMatch of decodedChunk.matchAll(posterPattern)) {
      if (
        /\.(?:jpe?g|webp|png)(?:\?|$)/i.test(posterMatch[1]) &&
        !photos.includes(posterMatch[1])
      ) {
        photos.push(posterMatch[1]);
      }
    }

    if (!name || photos.length === 0) continue;

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
      sold,
      removed,
      available: !sold && !removed,
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
      photos,
      telegram: "https://t.me/" + TELEGRAM_CHANNEL + "/" + id,
    };
    product.descriptionEn = englishDescription(product);
    products.push(product);
    statuses.push({
      id,
      name,
      normalizedName: normalizedName(name),
      sold,
      removed,
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

export function parseTelegramBotUpdates(updates) {
  const messagesById = new Map();

  for (const update of Array.isArray(updates) ? updates : []) {
    const message = update?.edited_channel_post || update?.channel_post;
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
    const name = quotedName(text);
    const { sold, removed, selling } = telegramTextStatus(text);

    if (name && (sold || removed)) {
      statuses.push({
        id,
        name,
        normalizedName: normalizedName(name),
        sold,
        removed,
      });
    }

    if (!selling || sold || removed || !name) continue;

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

function telegramStatusPage(payload) {
  const json = JSON.stringify(payload, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    "<!doctype html><html lang=ru><meta charset=utf-8>" +
    "<meta name=robots content='noindex,nofollow,noarchive'>" +
    "<title>Проверка Telegram — Art Nelli</title>" +
    "<body><h1>Проверка Telegram</h1><pre>" +
    json +
    "</pre></body></html>"
  );
}

async function telegramData(env) {
  const [publicData, botData] = await Promise.all([
    telegramPublicData(),
    telegramBotData(env),
  ]);
  const merged = mergeTelegramResults(publicData, botData);
  return {
    ...merged,
    ok: publicData.ok || botData.ok,
    publicFeed: publicData.ok,
    botConnected: botData.connected,
    botPendingUpdates: botData.pendingUpdates,
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === TELEGRAM_VERIFY_PATH ||
      ((url.pathname === TELEGRAM_SETUP_PATH ||
          url.pathname === TELEGRAM_SETUP_PATH + ".html") &&
        url.searchParams.get("check") === "telegram")
    ) {
      const payload = await telegramConnectionStatus(env);
      return new Response(telegramStatusPage(payload), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, max-age=0",
          "content-security-policy": "default-src 'none'; base-uri 'none'",
          "x-content-type-options": "nosniff",
          "x-robots-tag": "noindex, nofollow, noarchive",
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
