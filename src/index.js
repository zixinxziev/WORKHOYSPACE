const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, app: env.APP_NAME || "Ahoy's Workspace" });
      }

      // API endpoints are intentionally fail-closed until authentication,
      // session management, and role checks are implemented.
      return json({
        error: "API_NOT_CONFIGURED",
        message: "Authentication and protected API routes must be configured before production use."
      }, 501);
    }

    return env.ASSETS.fetch(request);
  }
};
