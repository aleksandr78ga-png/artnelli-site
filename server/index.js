const TELEGRAM_CHANNEL = "nelli_leotards";
const TELEGRAM_PUBLIC_URL = "https://t.me/s/" + TELEGRAM_CHANNEL;
const CACHE_TTL_MS = 15 * 60 * 1000;

let liveCache = { expiresAt: 0, payload: null };

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
    const sold = /(?:^|\s)(?:продан(?:о|а|ы)?|sold)(?:$|\s|[!.,✅❌])/imu.test(
      text,
    );
    const selling = /прода[её]тся|в\s+продаже|for\s+sale/iu.test(text);

    if (name && sold) {
      statuses.push({ id, name, normalizedName: normalizedName(name), sold: true });
    }

    if (!selling && !sold) continue;

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
      available: !sold,
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
    });
  }

  return { products, statuses };
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

async function telegramData() {
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
    telegramData(),
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
