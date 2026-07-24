(() => {
  "use strict";

  const MAX_CHANNEL = "https://max.ru/channel_artnelli";
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

  const app = window.WebApp || null;
  const grid = document.getElementById("catalog-grid");
  const count = document.getElementById("catalog-count");
  const empty = document.getElementById("catalog-empty");
  const catalogTitle = document.getElementById("catalog-title");
  const newModelsCount = document.getElementById("new-models-count");
  const usedModelsCount = document.getElementById("used-models-count");
  const showMore = document.getElementById("show-more");
  const cardTemplate = document.getElementById("product-card-template");
  const productDialog = document.getElementById("product-dialog");
  const productContent = document.getElementById("product-content");
  const orderDialog = document.getElementById("order-dialog");
  const orderForm = document.getElementById("order-form");
  const orderTitle = document.getElementById("order-title");
  const orderNote = document.getElementById("order-product-note");
  const orderStatus = document.getElementById("order-status");
  const sendOrderButton = document.getElementById("send-order");

  const formatPrice = (prices = []) => {
    if (!prices.length) return "Цена по запросу";
    const values = prices.filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return "Цена по запросу";
    const money = (value) => new Intl.NumberFormat("ru-RU").format(value) + " ₽";
    return values.length > 1 ? `${money(values[0])}–${money(values.at(-1))}` : money(values[0]);
  };

  const normalize = (value = "") => String(value)
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

  const productKey = (product) => normalize(product.name);

  function mergeProducts() {
    const base = Array.isArray(window.NELLI_CATALOG)
      ? window.NELLI_CATALOG.map((item) => ({ ...item, sold: Boolean(item.sold) }))
      : [];
    const byId = new Map(base.map((item) => [Number(item.id), item]));
    const live = window.NELLI_LIVE?.telegram;

    for (const incoming of live?.products || []) {
      const id = Number(incoming.id);
      const current = byId.get(id);
      byId.set(id, current ? { ...current, ...incoming } : { ...incoming });
    }

    const statuses = live?.statuses || [];
    for (const status of statuses) {
      const id = Number(status.id);
      const direct = byId.get(id);
      if (direct) {
        direct.sold = Boolean(status.sold);
        continue;
      }
      if (!status.sold) continue;
      const key = normalize(status.normalizedName || status.name);
      for (const product of byId.values()) {
        if (productKey(product) === key && Number(product.id) <= id) product.sold = true;
      }
    }

    state.products = [...byId.values()]
      .filter((product) => product?.name && product?.photos?.length)
      .sort((a, b) => {
        if (Boolean(a.sold) !== Boolean(b.sold)) return a.sold ? 1 : -1;
        return String(b.date || "").localeCompare(String(a.date || "")) || Number(b.id) - Number(a.id);
      });
    updateConditionCounts();
  }

  function modelWord(value) {
    const mod100 = value % 100;
    const mod10 = value % 10;
    if (mod100 >= 11 && mod100 <= 14) return "моделей";
    if (mod10 === 1) return "модель";
    if (mod10 >= 2 && mod10 <= 4) return "модели";
    return "моделей";
  }

  function updateConditionCounts() {
    const newCount = state.products.filter((product) => product.condition === "new").length;
    const usedCount = state.products.filter((product) => product.condition === "used").length;
    newModelsCount.textContent = `${newCount} ${modelWord(newCount)}`;
    usedModelsCount.textContent = `${usedCount} ${modelWord(usedCount)}`;
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
    catalogTitle.textContent = state.condition === "used" ? "Костюмы б/у" : "Новые модели";
    state.filtered = state.products.filter(productMatches);
    const visible = state.filtered.slice(0, state.visible);
    grid.replaceChildren();

    for (const product of visible) {
      const fragment = cardTemplate.content.cloneNode(true);
      const button = fragment.querySelector(".product-open");
      const image = fragment.querySelector(".product-image");
      image.src = "../" + product.photos[0].replace(/^\/+/, "");
      image.alt = `${product.name} — ${product.type === "dress" ? "платье" : product.type === "jumpsuit" ? "комбинезон" : "купальник"} Art Nelli`;
      fragment.querySelector(".product-name").textContent = product.name;
      fragment.querySelector(".product-height").textContent = product.height ? `Рост ${product.height} см` : "Параметры в карточке";
      fragment.querySelector(".product-price").textContent = formatPrice(product.prices);
      const productState = fragment.querySelector(".product-state");
      productState.textContent = product.sold
        ? "Продано"
        : product.condition === "used"
          ? "Б/у · наличие уточнить"
          : "Новая · наличие уточнить";
      productState.classList.toggle("sold", Boolean(product.sold));
      button.setAttribute("aria-label", `Открыть модель ${product.name}`);
      button.addEventListener("click", () => openProduct(product));
      grid.append(fragment);
    }

    count.textContent = state.filtered.length ? `${visible.length} из ${state.filtered.length}` : "0 моделей";
    empty.hidden = state.filtered.length !== 0;
    showMore.hidden = visible.length >= state.filtered.length;
  }

  function productUrl(product) {
    const url = new URL("/max/", window.location.origin);
    url.searchParams.set("product", String(product.id));
    return url.href;
  }

  function productSpecs(product) {
    const labels = [
      ["chest", "ОГ"],
      ["waist", "ОТ"],
      ["hips", "ОБ"],
      ["girth", "Дуга"],
    ];
    return labels
      .filter(([key]) => product.specs?.[key])
      .map(([key, label]) => `<span>${label} ${escapeHtml(product.specs[key])} см</span>`)
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
      app?.HapticFeedback?.impactOccurred?.("light", false);
    } catch (_) {
      // Haptic feedback is optional.
    }
  }

  function openProduct(product) {
    state.activeProduct = product;
    const gallery = product.photos
      .map((photo, index) => `<img src="../${escapeHtml(photo.replace(/^\/+/, ""))}" alt="${escapeHtml(product.name)} — фото ${index + 1}" loading="${index ? "lazy" : "eager"}">`)
      .join("");
    const description = product.description || "Описание модели уточняется.";
    productContent.innerHTML = `
      <div class="product-gallery">${gallery}</div>
      <section class="product-detail">
        <p class="eyebrow">${product.condition === "used" ? "Работа мастерской · б/у" : "Авторская модель Art Nelli"}</p>
        <h2>${escapeHtml(product.name)}</h2>
        <div class="detail-meta">
          ${product.height ? `<span>Рост ${escapeHtml(product.height)} см</span>` : ""}
          ${productSpecs(product)}
          ${product.sold ? "<span>Продано</span>" : ""}
        </div>
        <p class="detail-price">${escapeHtml(formatPrice(product.prices))}</p>
        <p class="detail-description">${escapeHtml(description)}</p>
        <p class="detail-note">Цена и наличие подтверждаются мастерской перед оформлением заказа.</p>
        <div class="detail-actions">
          <button class="primary-button" type="button" data-order>${product.sold ? "Подобрать похожую" : "Хочу эту модель"}</button>
          <button class="secondary-button" type="button" data-share>Поделиться в MAX</button>
        </div>
        <button class="detail-source" type="button" data-source>Оригинал в Telegram ↗</button>
      </section>`;

    productContent.querySelector("[data-order]").addEventListener("click", () => {
      productDialog.close();
      openOrder(product);
    });
    productContent.querySelector("[data-share]").addEventListener("click", () => shareProduct(product));
    productContent.querySelector("[data-source]").addEventListener("click", () => openExternal(product.telegram || TELEGRAM_CHANNEL));
    productDialog.showModal();
    document.body.classList.add("sheet-open");
    app?.BackButton?.show?.();
    haptic();
  }

  function openOrder(product = null) {
    orderForm.reset();
    orderStatus.textContent = "";
    orderStatus.className = "order-status";
    const customer = app?.initDataUnsafe?.user?.first_name || "";
    orderForm.elements.customer.value = customer;
    orderForm.elements.productId.value = product?.id || "";
    orderForm.elements.productName.value = product?.name || "";
    orderTitle.textContent = product ? product.name : "Индивидуальный пошив";
    orderNote.textContent = product
      ? (product.sold ? "Эта модель отмечена как проданная. Мастерская предложит похожий вариант." : "Нелли лично подтвердит цену и наличие этой модели.")
      : "Расскажите об образе — Нелли лично подтвердит свободную дату и сроки.";
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

  function openExternal(url) {
    haptic();
    if (app?.openLink) app.openLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  function openMax(url) {
    haptic();
    if (app?.openMaxLink) app.openMaxLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareInMax(text, link = "") {
    haptic();
    if (app?.shareMaxContent) {
      app.shareMaxContent({ text, ...(link ? { link } : {}) });
      return;
    }
    const payload = encodeURIComponent([text, link].filter(Boolean).join("\n"));
    window.open(`https://max.ru/:share?text=${payload}`, "_blank", "noopener,noreferrer");
  }

  function shareProduct(product) {
    shareInMax(
      `${product.name} — ${formatPrice(product.prices)}. Рост ${product.height || "уточнить"} см. Art Nelli.`,
      productUrl(product),
    );
  }

  function orderMessage(data) {
    const product = data.get("productName");
    return [
      "Заявка в мастерскую Art Nelli",
      product ? `Модель: ${product}` : "Индивидуальный пошив",
      `Имя: ${data.get("customer")}`,
      `Телефон / мессенджер: ${data.get("phone")}`,
      `Рост спортсменки: ${data.get("athleteHeight") || "не указан"}`,
      `Город: ${data.get("city") || "не указан"}`,
      `Срок / выступление: ${data.get("deadline") || "не указан"}`,
      `Пожелания: ${data.get("wishes") || "—"}`,
    ].join("\n");
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!orderForm.reportValidity()) return;
    const data = new FormData(orderForm);
    const payload = {
      initData: app?.initData || "",
      productId: data.get("productId"),
      productName: data.get("productName"),
      customer: data.get("customer"),
      phone: data.get("phone"),
      athleteHeight: data.get("athleteHeight"),
      city: data.get("city"),
      deadline: data.get("deadline"),
      wishes: data.get("wishes"),
    };
    sendOrderButton.disabled = true;
    orderStatus.className = "order-status";
    orderStatus.textContent = "Отправляем заявку…";

    if (payload.initData) {
      try {
        const response = await fetch("/api/max-order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          orderStatus.className = "order-status success";
          orderStatus.textContent = `Заявка ${result.orderId || ""} отправлена. Мастерская ответит в MAX.`;
          app?.disableClosingConfirmation?.();
          haptic();
          return;
        }
        if (![404, 503].includes(response.status)) throw new Error(result.error || "Ошибка отправки");
      } catch (error) {
        if (!navigator.onLine) {
          orderStatus.className = "order-status error";
          orderStatus.textContent = "Нет соединения. Проверьте интернет и повторите.";
          sendOrderButton.disabled = false;
          return;
        }
      }
    }

    orderStatus.className = "order-status";
    orderStatus.textContent = "Откроется выбор чата в MAX. Выберите чат Art Nelli и отправьте заявку.";
    shareInMax(orderMessage(data), data.get("productId") ? productUrl({ id: data.get("productId") }) : "https://artnelli.com/max/");
    sendOrderButton.disabled = false;
  }

  async function requestContact() {
    if (!app?.requestContact) {
      orderStatus.className = "order-status";
      orderStatus.textContent = "Введите номер вручную — получение контакта доступно внутри MAX.";
      return;
    }
    try {
      const result = await app.requestContact();
      if (result?.phone) {
        orderForm.elements.phone.value = result.phone.startsWith("+") ? result.phone : "+" + result.phone;
        orderStatus.textContent = "Номер получен из MAX.";
      }
    } catch (_) {
      orderStatus.textContent = "Номер не получен. Его можно ввести вручную.";
    }
  }

  function setViewport() {
    if (!app?.getViewportSize) return;
    app.getViewportSize().then((size) => {
      const height = Number.parseFloat(size?.height);
      if (Number.isFinite(height) && height > 300) {
        document.documentElement.style.setProperty("--viewport-height", `${height}px`);
      }
    }).catch(() => {});
  }

  function openStartProduct() {
    const queryId = new URLSearchParams(window.location.search).get("product");
    const startParam = app?.initDataUnsafe?.start_param || "";
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

  document.querySelectorAll("[data-max-link]").forEach((button) => {
    button.addEventListener("click", () => openMax(button.dataset.maxLink || MAX_CHANNEL));
  });

  document.querySelectorAll("[data-external-link]").forEach((button) => {
    button.addEventListener("click", () => openExternal(button.dataset.externalLink));
  });

  showMore.addEventListener("click", () => {
    state.visible += PAGE_SIZE;
    renderCatalog();
  });
  document.getElementById("custom-order").addEventListener("click", () => openOrder());
  document.getElementById("request-contact").addEventListener("click", requestContact);
  orderForm.addEventListener("submit", submitOrder);
  productDialog.addEventListener("close", onSheetClose);
  orderDialog.addEventListener("close", onSheetClose);
  app?.BackButton?.onClick?.(closeTopSheet);

  mergeProducts();
  renderCatalog();
  setViewport();
  openStartProduct();

  window.addEventListener("nelli:live-data", () => {
    mergeProducts();
    renderCatalog(true);
  }, { once: true });
})();
