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

  let startOpened = false;
  let sheetHistory = false;
  const { t, translatePage } = window.NELLI_I18N;
  let language = "ru";
  try { language = localStorage.getItem("nelliVkLanguage") || "ru"; } catch (_) {}
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
    const values = prices.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
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

  function photoUrl(photo) {
    try { const url = new URL(String(photo || ''), 'https://artnelli.com/'); return url.protocol === 'https:' ? url.href : ''; }
    catch (_) { return ''; }
  }

  function mergeProducts() {
    state.products = window.NELLI_CATALOG_MODEL.merge(window.NELLI_CATALOG || [], window.NELLI_LIVE?.telegram);
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
      image.src = photoUrl(product.photos[0]);
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
    empty.hidden = state.filtered.length !== 0 || !Array.isArray(window.NELLI_CATALOG);
    showMore.hidden = visible.length >= state.filtered.length;
  }

  function productUrl(product) {
    const appId = window.NELLI_PLATFORM?.appId;
    if (appId) return `https://vk.ru/app${appId}#product=${encodeURIComponent(product.id)}`;
    return product.telegram || TELEGRAM_CHANNEL;
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
    window.NELLI_PLATFORM?.optional('VKWebAppTapticImpactOccurred', {style:'light'});
  }

  function pushSheetHash(hash) {
    if (location.hash === hash) return;
    history.pushState(null, '', hash);
    sheetHistory = true;
  }

  function openProduct(product) {
    state.activeProduct = product;
    pushSheetHash(`#product=${product.id}`);
    const gallery = product.photos
      .map((photo, index) => `<img src="${escapeHtml(photoUrl(photo))}" alt="${escapeHtml(productName(product))} — ${t("фото")} ${index + 1}" loading="${index ? "lazy" : "eager"}">`)
      .join("");
    const description = (window.NELLI_I18N.language === "en" ? product.descriptionEn || product.description : product.description) || t("Описание модели уточняется.");
    productContent.innerHTML = `
      <div class="product-gallery" aria-label="Фотографии модели">${gallery}</div>
      <div class="gallery-nav" ${product.photos.length < 2 ? 'hidden' : ''}>
        <button type="button" data-photo-prev aria-label="Предыдущее фото">←</button>
        <span data-photo-count aria-live="polite">1 / ${product.photos.length}</span>
        <button type="button" data-photo-next aria-label="Следующее фото">→</button>
      </div>
      <section class="product-detail">
        <p class="eyebrow">${product.condition === "rental" ? t("Аренда") : product.condition === "used" ? t("Работа мастерской · б/у") : t("Авторская модель Art Nelli")}</p>
        <h2>${escapeHtml(productName(product))}</h2>
        <div class="detail-meta">
          ${product.height ? `<span>${t("Рост")} ${escapeHtml(product.height)} ${t("см")}</span>` : ""}
          ${productSpecs(product)}
          ${product.sold ? "<span>Продано</span>" : ""}
        </div>
        <p class="detail-price">${escapeHtml(offerPrice(product))}</p>
        ${product.prices?.length > 1 ? '<p class="detail-variants">Цены вариантов указаны в описании модели.</p>' : ''}
        <p class="detail-description">${escapeHtml(description)}</p>
        <p class="detail-note">Цена и наличие подтверждаются мастерской перед оформлением заказа. Название и ссылка на модель появятся в сообщении Нелли. Нажмите «Отправить» в Telegram.</p>
        <div class="detail-actions">
          <button class="primary-button" type="button" data-order>${product.sold ? t("Подобрать похожую") : product.condition === "rental" ? t("Хочу взять в аренду") : t("Хочу эту модель")}</button>
          <button class="secondary-button" type="button" data-share>Поделиться моделью</button>
        </div>
        <p class="detail-feedback" role="status"></p>
        <button class="detail-source" type="button" data-source>Оригинал в Telegram ↗</button>
      </section>`;

    const galleryElement = productContent.querySelector('.product-gallery');
    const photoCount = productContent.querySelector('[data-photo-count]');
    let photoIndex = 0;
    const showPhoto = (direction) => {
      photoIndex = (photoIndex + direction + product.photos.length) % product.photos.length;
      galleryElement.scrollTo({left:photoIndex * (galleryElement.clientWidth + 8), behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      photoCount.textContent = `${photoIndex + 1} / ${product.photos.length}`;
    };
    productContent.querySelector('[data-photo-prev]').addEventListener('click', () => showPhoto(-1));
    productContent.querySelector('[data-photo-next]').addEventListener('click', () => showPhoto(1));
    galleryElement.addEventListener('scroll', () => {
      photoIndex = Math.max(0, Math.min(product.photos.length - 1, Math.round(galleryElement.scrollLeft / (galleryElement.clientWidth + 8))));
      photoCount.textContent = `${photoIndex + 1} / ${product.photos.length}`;
    }, {passive:true});
    productContent.querySelector("[data-order]").addEventListener("click", () => openProductChat(product));
    productContent.querySelector("[data-share]").addEventListener("click", () => shareProduct(product));
    productContent.querySelector("[data-source]").addEventListener("click", () => openExternal(product.telegram || TELEGRAM_CHANNEL));
    translatePage(productContent);
    if (!productDialog.open) productDialog.showModal();
    document.body.classList.add("sheet-open");
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
    pushSheetHash("#order");
    orderDialog.showModal();
    document.body.classList.add("sheet-open");
    haptic();
  }

  function onSheetClose() {
    if (!productDialog.open && !orderDialog.open) {
      document.body.classList.remove("sheet-open");
      if (sheetHistory) { sheetHistory = false; history.back(); }
      else if (/^#(?:product=|order)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function openTelegram(url) { openExternal(url); }

  function openExternal(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['t.me','artnelli.com'].includes(url.hostname)) return;
      window.open(url.href, '_blank', 'noopener,noreferrer');
    } catch (_) {}
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

  async function shareProduct(product) {
    const link = productUrl(product);
    const host = window.NELLI_PLATFORM;
    if (host?.embedded && window.vkBridge?.supports('VKWebAppShare')) {
      await host.optional('VKWebAppShare', {link});
      return;
    }
    if (navigator.share) {
      try { await navigator.share({title:productName(product), url:link}); return; }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    const feedback = productContent.querySelector('.detail-feedback');
    try { await navigator.clipboard.writeText(link); feedback.textContent = 'Ссылка на модель скопирована.'; }
    catch (_) { feedback.textContent = link; }
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

  function openStartProduct() {
    if (startOpened) return;
    const hashId = /^#product=(-?\d+)$/.exec(location.hash)?.[1];
    const queryId = new URLSearchParams(location.search).get('product');
    const productId = Number(hashId || queryId);
    if (!productId) return;
    const product = state.products.find(item => Number(item.id) === productId);
    if (product) { startOpened = true; openProduct(product); }
  }
  window.addEventListener('popstate', () => {
    sheetHistory = false;
    const id = Number(/^#product=(-?\d+)$/.exec(location.hash)?.[1]);
    if (location.hash !== '#order' && orderDialog.open) orderDialog.close();
    if (!id) { if (productDialog.open) productDialog.close(); return; }
    const product = state.products.find(p => Number(p.id) === id);
    if (product) openProduct(product);
  });

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
      document.querySelectorAll(".filter-chip").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-pressed", "false"); });
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
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

  document.getElementById("language-toggle").addEventListener("click", () => {
    window.NELLI_I18N.language = window.NELLI_I18N.language === "ru" ? "en" : "ru";
    try { localStorage.setItem("nelliVkLanguage", window.NELLI_I18N.language); } catch (_) {}
    applyLanguage();
    updateConditionCounts();
    renderCatalog();
    if (productDialog.open && state.activeProduct) openProduct(state.activeProduct);
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
  applyLanguage();
  mergeProducts();
  renderCatalog();
  openStartProduct();

  function onCatalogChange() {
    const activeId = state.activeProduct?.id;
    mergeProducts();
    renderCatalog();
    if (productDialog.open && activeId) {
      const refreshed = state.products.find(product => product.id === activeId);
      if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(state.activeProduct)) openProduct(refreshed);
      else if (refreshed) state.activeProduct = refreshed;
      else productDialog.close();
    }
    openStartProduct();
  }
  window.addEventListener("nelli:live-data", onCatalogChange);
  window.addEventListener("nelli:catalog-base", onCatalogChange);
})();


