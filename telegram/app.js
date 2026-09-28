(() => {
  "use strict";

  const TELEGRAM_PERSONAL = "https://t.me/nelli_leotard";
  const TELEGRAM_CHANNEL = "https://t.me/nelli_leotards";
  const PAGE_SIZE = 18;

  const state = {
    products: [],
    filtered: [],
    visible: PAGE_SIZE,
    type: "all",
    condition: "new",
    query: "",
    activeProduct: null,
  };

  const app = window.Telegram?.WebApp || null;
  const { t, translatePage } = window.NELLI_I18N;
  let language = "ru";
  try { language = localStorage.getItem("nelliTelegramLanguage") || "ru"; } catch (_) {}
  const queryLanguage = new URLSearchParams(location.search).get("lang");
  if (queryLanguage === "en" || queryLanguage === "ru") language = queryLanguage;
  window.NELLI_I18N.language = language === "en" ? "en" : "ru";
  const locale = () => window.NELLI_I18N.language === "en" ? "en-GB" : "ru-RU";
  const productName = (product) => window.NELLI_I18N.language === "en" ? product.nameEn || product.name : product.name;
  const grid = document.getElementById("catalog-grid");
  const count = document.getElementById("catalog-count");
  const empty = document.getElementById("catalog-empty");
  const catalogTitle = document.getElementById("catalog-title");
  const newModelsCount = document.getElementById("new-models-count");
  const usedModelsCount = document.getElementById("used-models-count");
  const rentalModelsCount = document.getElementById("rental-models-count");
  const showMore = document.getElementById("show-more");
  const cardTemplate = document.getElementById("product-card-template");
  const productDialog = document.getElementById("product-dialog");
  const productContent = document.getElementById("product-content");
  const orderDialog = document.getElementById("order-dialog");
  const orderForm = document.getElementById("order-form");
  const orderMonths = document.getElementById("order-months");
  const orderStatus = document.getElementById("order-status");

  const formatPrice = (prices = []) => {
    if (!prices.length) return t("Цена по запросу");
    const values = prices.filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return t("Цена по запросу");
    const money = (value) => new Intl.NumberFormat(locale()).format(value) + " ₽";
    return values.length > 1 ? `${money(values[0])}–${money(values.at(-1))}` : money(values[0]);
  };

  function offerPrice(product) {
    const amount = formatPrice(product.prices);
    return product.condition === "rental" ? t("Аренда") + ": " + amount : amount;
  }

  const normalize = (value = "") => String(value)
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

  const productKey = (product) => normalize(product.name);

  function mergeProducts() {
    const base = Array.isArray(window.NELLI_CATALOG)
      ? window.NELLI_CATALOG.map((item) => ({
          ...item,
          sold: Boolean(item.sold),
          removed: item.removed === true,
          available: item.removed !== true,
        }))
      : [];
    const byId = new Map(base.map((item) => [Number(item.id), item]));
    const live = window.NELLI_LIVE?.telegram;

    for (const incoming of live?.products || []) {
      const id = Number(incoming.id);
      const current = byId.get(id);
      const merged = current ? { ...current, ...incoming } : { ...incoming };
      merged.sold = Boolean(merged.sold);
      merged.removed = merged.removed === true;
      merged.available = !merged.removed;
      byId.set(id, merged);
    }

    const statuses = live?.statuses || [];
    for (const status of statuses) {
      const id = Number(status.id);
      const direct = byId.get(id);
      if (direct) {
        direct.sold = Boolean(status.sold);
        direct.removed = status.removed === true;
        direct.available = !direct.removed;
        continue;
      }
      const key = normalize(status.normalizedName || status.name);
      if (!key) continue;
      const matching = [...byId.values()]
        .filter((product) => productKey(product) === key && Number(product.id) <= id)
        .sort((left, right) => Number(right.id) - Number(left.id))[0];
      if (matching) {
        matching.sold = Boolean(status.sold);
        matching.removed = status.removed === true;
        matching.available = !matching.removed;
      }
    }

    state.products = [...byId.values()]
      .filter((product) => product?.removed !== true)
      .filter((product) => product?.name && product?.photos?.length)
      .sort((a, b) => {
        if (Boolean(a.sold) !== Boolean(b.sold)) return a.sold ? 1 : -1;
        return String(b.date || "").localeCompare(String(a.date || "")) || Number(b.id) - Number(a.id);
      });
    updateConditionCounts();
  }

  function modelWord(value) {
    if (window.NELLI_I18N.language === "en") return value === 1 ? "model" : "models";
    const mod100 = value % 100;
    const mod10 = value % 10;
    if (mod100 >= 11 && mod100 <= 14) return t("моделей");
    if (mod10 === 1) return t("модель");
    if (mod10 >= 2 && mod10 <= 4) return t("модели");
    return t("моделей");
  }

  function updateConditionCounts() {
    const newCount = state.products.filter((product) => product.condition === "new").length;
    const usedCount = state.products.filter((product) => product.condition === "used").length;
    newModelsCount.textContent = `${newCount} ${modelWord(newCount)}`;
    usedModelsCount.textContent = `${usedCount} ${modelWord(usedCount)}`;
    const rentalCount = state.products.filter((product) => product.condition === "rental").length;
    rentalModelsCount.textContent = `${rentalCount} ${modelWord(rentalCount)}`;
  }

  function productMatches(product) {
    if (product.condition !== state.condition) return false;
    if (state.type !== "all" && product.type !== state.type) return false;
    if (!state.query) return true;
    const haystack = normalize([
      product.name,
      product.nameEn,
      product.height,
      product.description,
      product.descriptionEn,
    ].join(" "));
    return state.query.split(" ").every((part) => haystack.includes(part));
  }

  function renderCatalog(reset = false) {
    if (reset) state.visible = PAGE_SIZE;
    catalogTitle.textContent = state.condition === "rental" ? t("Аренда") : state.condition === "used" ? t("Костюмы б/у") : t("Новые модели");
    state.filtered = state.products.filter(productMatches);
    const visible = state.filtered.slice(0, state.visible);
    grid.replaceChildren();

    for (const product of visible) {
      const fragment = cardTemplate.content.cloneNode(true);
      const button = fragment.querySelector(".product-open");
      const image = fragment.querySelector(".product-image");
      image.src = "../" + product.photos[0].replace(/^\/+/, "");
      image.alt = `${productName(product)} — ${product.type === "dress" ? t("платье") : product.type === "jumpsuit" ? t("комбинезон") : t("купальник")} Art Nelli`;
      fragment.querySelector(".product-name").textContent = productName(product);
      fragment.querySelector(".product-height").textContent = product.height ? `${t("Рост")} ${product.height} ${t("см")}` : t("Параметры в карточке");
      fragment.querySelector(".product-price").textContent = offerPrice(product);
      const productState = fragment.querySelector(".product-state");
      productState.textContent = product.sold
        ? t("Продано")
        : product.condition === "rental"
          ? t("Аренда · наличие уточнить")
        : product.condition === "used"
          ? t("Б/у · наличие уточнить")
          : t("Новая · наличие уточнить");
      productState.classList.toggle("sold", Boolean(product.sold));
      button.setAttribute("aria-label", `${t("Открыть модель")} ${productName(product)}`);
      button.addEventListener("click", () => openProduct(product));
      grid.append(fragment);
    }

    count.textContent = state.filtered.length ? `${visible.length} ${t("из")} ${state.filtered.length}` : `0 ${modelWord(0)}`;
    empty.hidden = state.filtered.length !== 0;
    showMore.hidden = visible.length >= state.filtered.length;
  }

  function productUrl(product) {
    const url = new URL("https://artnelli.com/telegram/");
    url.searchParams.set("product", String(product.id));
    return url.href;
  }

  function productSpecs(product) {
    const labels = [
      ["chest", t("ОГ")],
      ["waist", t("ОТ")],
      ["hips", t("ОБ")],
      ["girth", t("Дуга")],
    ];
    return labels
      .filter(([key]) => product.specs?.[key])
      .map(([key, label]) => `<span>${t(label)} ${escapeHtml(product.specs[key])} ${t("см")}</span>`)
      .join("");
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function haptic() {
    try {
      app?.HapticFeedback?.impactOccurred?.("light");
    } catch (_) {
      // Haptic feedback is optional.
    }
  }

  function openProduct(product) {
    state.activeProduct = product;
    const gallery = product.photos
      .map((photo, index) => `<img src="../${escapeHtml(photo.replace(/^\/+/, ""))}" alt="${escapeHtml(productName(product))} — ${t("фото")} ${index + 1}" loading="${index ? "lazy" : "eager"}">`)
      .join("");
    const description = (window.NELLI_I18N.language === "en" ? product.descriptionEn || product.description : product.description) || t("Описание модели уточняется.");
    productContent.innerHTML = `
      <div class="product-gallery">${gallery}</div>
      <section class="product-detail">
        <p class="eyebrow">${product.condition === "rental" ? t("Аренда") : product.condition === "used" ? t("Работа мастерской · б/у") : t("Авторская модель Art Nelli")}</p>
        <h2>${escapeHtml(productName(product))}</h2>
        <div class="detail-meta">
          ${product.height ? `<span>${t("Рост")} ${escapeHtml(product.height)} ${t("см")}</span>` : ""}
          ${productSpecs(product)}
          ${product.sold ? "<span>Продано</span>" : ""}
        </div>
        <p class="detail-price">${escapeHtml(offerPrice(product))}</p>
        <p class="detail-description">${escapeHtml(description)}</p>
        <p class="detail-note">Цена и наличие подтверждаются мастерской перед оформлением заказа. Название и ссылка на модель появятся в сообщении Нелли. Нажмите «Отправить» в Telegram.</p>
        <div class="detail-actions">
          <button class="primary-button" type="button" data-order>${product.sold ? t("Подобрать похожую") : product.condition === "rental" ? t("Хочу взять в аренду") : t("Хочу эту модель")}</button>
          <button class="secondary-button" type="button" data-share>Поделиться в Telegram</button>
        </div>
        <button class="detail-source" type="button" data-source>Оригинал в Telegram ↗</button>
      </section>`;

    productContent.querySelector("[data-order]").addEventListener("click", () => openProductChat(product));
    productContent.querySelector("[data-share]").addEventListener("click", () => shareProduct(product));
    productContent.querySelector("[data-source]").addEventListener("click", () => openExternal(product.telegram || TELEGRAM_CHANNEL));
    translatePage(productContent);
    productDialog.showModal();
    document.body.classList.add("sheet-open");
    app?.BackButton?.show?.();
    haptic();
  }

  function renderOrderMonths() {
    const start = new Date();
    start.setDate(1);
    orderMonths.replaceChildren();

    for (let index = 0; index < 6; index += 1) {
      const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = document.createElement("label");
      const radio = document.createElement("input");
      const card = document.createElement("span");
      const title = document.createElement("strong");
      const note = document.createElement("span");

      label.className = "order-month";
      radio.type = "radio";
      radio.name = "month";
      radio.value = value;
      radio.required = index === 0;
      card.className = "order-month-card";
      title.textContent = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(date);
      note.textContent = t("Доступность подтверждает Нелли");
      card.append(title, note);
      label.append(radio, card);
      orderMonths.append(label);
    }
  }

  function openOrder() {
    orderForm.reset();
    orderStatus.textContent = "";
    orderStatus.className = "order-status";
    renderOrderMonths();
    orderDialog.showModal();
    document.body.classList.add("sheet-open");
    app?.BackButton?.show?.();
    app?.enableClosingConfirmation?.();
    haptic();
  }

  function closeTopSheet() {
    if (orderDialog.open) {
      orderDialog.close();
      return true;
    }
    if (productDialog.open) {
      productDialog.close();
      return true;
    }
    return false;
  }

  function onSheetClose() {
    if (!productDialog.open && !orderDialog.open) {
      document.body.classList.remove("sheet-open");
      app?.BackButton?.hide?.();
      app?.disableClosingConfirmation?.();
    }
  }

  function openTelegram(url) {
    haptic();
    if (app?.initData && app?.openTelegramLink) app.openTelegramLink(url);
    else window.location.assign(url);
  }

  function openExternal(url) {
    if (new URL(url).hostname === "t.me") return openTelegram(url);
    if (app?.initData && app?.openLink) app.openLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  function openPersonalChat(text) {
    const url = new URL(TELEGRAM_PERSONAL);
    url.searchParams.set("text", text);
    openTelegram(url.href);
  }

  function productInquiryMessage(product) {
    return [
      product.sold ? t("Здравствуйте! Хочу подобрать похожую модель.") : product.condition === "rental" ? t("Здравствуйте! Хочу взять эту модель в аренду.") : t("Здравствуйте! Хочу эту модель."),
      `${t("Модель")}: «${productName(product)}»`,
      `${t("Рост")}: ${product.height || t("уточнить")} ${t("см")}`,
      `ID: ${product.id}`,
      `${t("Карточка модели")}: ${productUrl(product)}`,
    ].join("\n");
  }

  function openProductChat(product) {
    openPersonalChat(productInquiryMessage(product));
  }

  function shareProduct(product) {
    const url = new URL("https://t.me/share/url");
    url.searchParams.set("url", productUrl(product));
    url.searchParams.set("text", `${productName(product)} — ${offerPrice(product)}. Art Nelli.`);
    openTelegram(url.href);
  }

  function bookingMessage(data) {
    const [year, month] = String(data.get("month")).split("-").map(Number);
    const monthText = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" })
      .format(new Date(year, month - 1, 1));
    return [
      `${t("Здравствуйте! Хочу записаться на индивидуальный пошив")} — ${monthText}.`,
      t("Подтверждаю, что ознакомился(ась) и понимаю условия оплаты 15 000 ₽ за работу над эскизами: при продолжении заказа сумма входит в итоговую стоимость; если после выполненной работы над эскизами заказ прекращается, оплата не возвращается."),
      t("Пожалуйста, подтвердите доступность слота."),
    ].join("\n");
  }

  function submitOrder(event) {
    event.preventDefault();
    if (!orderForm.reportValidity()) return;
    const data = new FormData(orderForm);
    openPersonalChat(bookingMessage(data));
  }

  function setViewport() {
    const height = Number(app?.viewportStableHeight);
    if (height > 300) document.documentElement.style.setProperty("--viewport-height", `${height}px`);
  }

  function openStartProduct() {
    const queryId = new URLSearchParams(window.location.search).get("product");
    const startParam = app?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tgWebAppStartParam") || "";
    const startId = /^product_(\d+)$/.exec(startParam)?.[1];
    const productId = Number(queryId || startId);
    if (!Number.isFinite(productId)) return;
    const product = state.products.find((item) => Number(item.id) === productId);
    if (product) window.setTimeout(() => openProduct(product), 250);
  }

  document.getElementById("catalog-search").addEventListener("input", (event) => {
    state.query = normalize(event.target.value);
    renderCatalog(true);
  });

  document.querySelectorAll(".condition-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".condition-tab").forEach((item) => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
      state.condition = button.dataset.condition;
      renderCatalog(true);
      haptic();
    });
  });

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.type = button.dataset.type;
      renderCatalog(true);
      haptic();
    });
  });

  document.querySelectorAll("[data-telegram-link]").forEach((button) => {
    button.addEventListener("click", () => openTelegram(button.dataset.telegramLink || TELEGRAM_CHANNEL));
  });

  document.querySelectorAll("[data-external-link]").forEach((button) => {
    button.addEventListener("click", () => openExternal(button.dataset.externalLink));
  });

  showMore.addEventListener("click", () => {
    state.visible += PAGE_SIZE;
    renderCatalog();
  });
  document.getElementById("custom-order").addEventListener("click", () => openOrder());
  orderForm.addEventListener("submit", submitOrder);
  productDialog.addEventListener("close", onSheetClose);
  orderDialog.addEventListener("close", onSheetClose);
  app?.BackButton?.onClick?.(closeTopSheet);

  document.getElementById("language-toggle").addEventListener("click", () => {
    window.NELLI_I18N.language = window.NELLI_I18N.language === "ru" ? "en" : "ru";
    try { localStorage.setItem("nelliTelegramLanguage", window.NELLI_I18N.language); } catch (_) {}
    applyLanguage();
    updateConditionCounts();
    renderCatalog();
    if (orderDialog.open) {
      const selected = orderForm.querySelector("[name=month]:checked")?.value;
      renderOrderMonths();
      for (const input of orderForm.querySelectorAll("[name=month]")) input.checked = input.value === selected;
    }
  });
  function applyLanguage() {
    document.documentElement.lang = window.NELLI_I18N.language;
    translatePage(document.body);
    document.getElementById("language-toggle").textContent = window.NELLI_I18N.language === "ru" ? "EN" : "RU";
  }
  try { app?.ready?.(); app?.expand?.(); } catch (_) {}
  app?.onEvent?.("viewportChanged", setViewport);
  applyLanguage();
  mergeProducts();
  renderCatalog();
  setViewport();
  openStartProduct();

  window.addEventListener("nelli:live-data", () => {
    mergeProducts();
    renderCatalog(true);
  }, { once: true });
})();
