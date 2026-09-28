(() => {
  const endpoint = "/api/analytics/collect";

  function sourceName() {
    const campaign = new URLSearchParams(location.search).get("utm_source");
    if (campaign) {
      return campaign.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48) || "campaign";
    }
    if (!document.referrer) return "direct";
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === location.origin) return "internal";
      const host = referrer.hostname.toLowerCase();
      if (host.includes("google.")) return "google";
      if (host.includes("yandex.")) return "yandex";
      if (host.includes("bing.")) return "bing";
      if (host.includes("instagram.")) return "instagram";
      if (host === "t.me" || host.includes("telegram.")) return "telegram";
      if (host.includes("vk.")) return "vk";
      return host.replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").slice(0, 48) || "referral";
    } catch (error) {
      return "referral";
    }
  }

  const source = sourceName();

  function send(event) {
    const payload = JSON.stringify({
      event,
      path: location.pathname,
      source,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  }

  function clickEvent(target) {
    const product = target.closest("[data-product-id]");
    if (product) return "product_open";
    const link = target.closest("a,button");
    if (!link) return "";
    const href = link instanceof HTMLAnchorElement
      ? (link.getAttribute("href") || "")
      : "";
    if (/wa\.me|whatsapp/i.test(href)) return "whatsapp_open";
    if (/t\.me|telegram/i.test(href)) return "telegram_open";
    if (/\.pdf(?:$|[?#])/i.test(href)) return "measurement_download";
    if (href.includes("#stock") || /catalog/i.test(link.id || "")) return "catalog_open";
    if (
      href.includes("#booking") ||
      link.closest("#booking") ||
      link.closest("#booking-form")
    ) {
      return link.closest("#booking-form") ? "booking_send" : "booking_open";
    }
    if (/poshiv-kupalnikov|tailor/i.test(href)) return "tailoring_open";
    return "";
  }

  document.addEventListener("click", (event) => {
    const name = clickEvent(event.target);
    if (name) send(name);
  }, { capture: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => send("pageview"), { once: true });
  } else {
    send("pageview");
  }
})();
