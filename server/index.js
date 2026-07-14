export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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