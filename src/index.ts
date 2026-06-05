import { Hono } from "hono";
import type { Env } from "./env";
import { openAiRoutes } from "./routes/openai";
import { mediaRoutes } from "./routes/media";
import { adminRoutes } from "./routes/admin";
import { runKvDailyClear } from "./kv/cleanup";
import { PROJECT_VERSION, getLatestReleaseInfo } from "./meta";
import { getSettings } from "./settings";

const app = new Hono<{ Bindings: Env }>();

function getAssets(env: Env): Fetcher | null {
  const anyEnv = env as unknown as { ASSETS?: unknown };
  const assets = anyEnv.ASSETS as { fetch?: unknown } | undefined;
  return assets && typeof assets.fetch === "function" ? (assets as Fetcher) : null;
}

function getBuildSha(env: Env): string {
  const v = String((env as any)?.BUILD_SHA ?? "").trim();
  return v || "dev";
}

function isDebugRequest(c: any): boolean {
  try {
    return new URL(c.req.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}

function withResponseHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function assetFetchError(message: string, buildSha: string): Response {
  return new Response(message, {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8", "x-grok2api-build": buildSha },
  });
}

function shouldInlineAdminHeader(pathname: string): boolean {
  return [
    "/admin/account.html",
    "/admin/config.html",
    "/admin/cache.html",
    "/keys/keys.html",
    "/chat/chat_admin.html",
    "/datacenter/datacenter.html",
  ].includes(pathname);
}

async function getAdminHeaderHtml(assets: Fetcher, requestUrl: string): Promise<string> {
  const url = new URL(requestUrl);
  url.pathname = "/admin/header";
  url.search = "";
  const res = await assets.fetch(new Request(url.toString(), { method: "GET" }));
  return res.ok ? await res.text() : "";
}

function inlineAdminHeader(body: string, headerHtml: string): string {
  const html = headerHtml.trim();
  if (!html || !body.includes('id="admin-header"')) return body;
  return body.replace(
    /(<div id="admin-header"[^>]*>)(?:\s*)<\/div>/,
    (_match, openTag: string) => `${openTag}${html}</div>`,
  );
}

function redirectVersionedAdmin(c: any, pathname: string): Response {
  const buildSha = getBuildSha(c.env as Env);
  return c.redirect(`${pathname}?v=${encodeURIComponent(buildSha)}`, 302);
}

function isAssetRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchAssetResource(assets: Fetcher, url: URL, raw: Request): Promise<Response> {
  let current = new URL(url.toString());
  for (let redirects = 0; redirects < 3; redirects += 1) {
    const res = await assets.fetch(new Request(current.toString(), raw));
    if (!isAssetRedirect(res.status)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    const next = new URL(location, current);
    if (next.origin !== current.origin) return res;
    current = next;
  }
  return assets.fetch(new Request(current.toString(), raw));
}

async function fetchAsset(c: any, pathname: string): Promise<Response> {
  const assets = getAssets(c.env as Env);
  const buildSha = getBuildSha(c.env as Env);
  if (!assets) {
    console.error("ASSETS binding missing: check wrangler.toml assets binding");
    return assetFetchError(
      'Internal Server Error: missing ASSETS binding. Check `wrangler.toml` `assets = { directory = \"./app/static\", binding = \"ASSETS\" }` and redeploy.',
      buildSha,
    );
  }

  const url = new URL(c.req.url);
  url.pathname = pathname;
  try {
    const res = await fetchAssetResource(assets, url, c.req.raw);
    const extra: Record<string, string> = { "x-grok2api-build": buildSha };

    // Avoid caching UI files aggressively, otherwise users may keep seeing old UI after redeploy.
    // We keep images/videos cacheable (handled by KV + cache proxy paths), but HTML/JS/CSS should refresh quickly.
    const lower = pathname.toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css")) {
      extra["cache-control"] = "no-store, no-cache, must-revalidate";
      extra["pragma"] = "no-cache";
      extra["expires"] = "0";
    }

    if (lower.endsWith(".html")) {
      let body = await res.text();
      if (shouldInlineAdminHeader(pathname)) {
        const headerHtml = await getAdminHeaderHtml(assets, c.req.url).catch(() => "");
        body = inlineAdminHeader(body, headerHtml);
      }
      return withResponseHeaders(
        new Response(body.replaceAll("{{APP_VERSION}}", buildSha), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
        extra,
      );
    }

    return withResponseHeaders(res, extra);
  } catch (err) {
    console.error(`ASSETS fetch failed (${pathname}):`, err);
    const detail = isDebugRequest(c) ? `\n\n${err instanceof Error ? err.stack || err.message : String(err)}` : "";
    return assetFetchError(`Internal Server Error: failed to fetch asset ${pathname}.${detail}`, buildSha);
  }
}

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  const buildSha = getBuildSha(c.env as Env);
  const detail = isDebugRequest(c) ? `\n\n${err instanceof Error ? err.stack || err.message : String(err)}` : "";
  const res = c.text(`Internal Server Error${detail}`, 500);
  return withResponseHeaders(res, { "x-grok2api-build": buildSha });
});

// Backward-compatible local-cache viewer URLs used by the multi-page admin UI.
// In Workers we serve cache via /images/*, so redirect /v1/files/* to /images/*.
app.get("/v1/files/image", (c) => {
  const id = String(c.req.query("id") ?? "").trim();
  if (!id) return c.text("Missing id", 400);
  return c.redirect(`/images/${encodeURIComponent(id)}`, 302);
});
app.get("/v1/files/video", (c) => {
  const id = String(c.req.query("id") ?? "").trim();
  if (!id) return c.text("Missing id", 400);
  return c.redirect(`/images/${encodeURIComponent(id)}`, 302);
});
app.get("/v1/files/image/:imgPath{.+}", (c) =>
  c.redirect(`/images/${encodeURIComponent(c.req.param("imgPath"))}`, 302),
);
app.get("/v1/files/video/:imgPath{.+}", (c) =>
  c.redirect(`/images/${encodeURIComponent(c.req.param("imgPath"))}`, 302),
);

app.route("/v1", openAiRoutes);
app.route("/", mediaRoutes);
app.route("/", adminRoutes);

app.get("/_worker.js", (c) => c.notFound());

app.get("/meta", (c) => c.json({ version: PROJECT_VERSION }));

app.get("/meta/update", async (c) => {
  const force = String(c.req.query("force") ?? "").trim().toLowerCase();
  return c.json(await getLatestReleaseInfo(force === "1" || force === "true" || force === "yes" || force === "on"));
});

app.get("/", (c) => c.redirect("/admin", 302));

app.get("/login", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  return c.redirect(`/admin/login?v=${encodeURIComponent(buildSha)}`, 302);
});

// Legacy (old admin UI): keep /manage as an alias.
app.get("/manage", (c) => {
  return redirectVersionedAdmin(c, "/admin/account");
});

app.get("/admin", (c) => c.redirect("/admin/login", 302));

app.get("/admin/login", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/login?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/admin/login.html");
});

app.get("/admin/account", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/account?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/admin/account.html");
});

app.get("/admin/token", (c) => {
  return redirectVersionedAdmin(c, "/admin/account");
});

app.get("/token", (c) => redirectVersionedAdmin(c, "/admin/account"));
app.get("/token/token.html", (c) => redirectVersionedAdmin(c, "/admin/account"));
app.get("/config", (c) => redirectVersionedAdmin(c, "/admin/config"));
app.get("/config/config.html", (c) => redirectVersionedAdmin(c, "/admin/config"));
app.get("/cache", (c) => redirectVersionedAdmin(c, "/admin/cache"));
app.get("/cache/cache.html", (c) => redirectVersionedAdmin(c, "/admin/cache"));

app.get("/admin/datacenter", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/datacenter?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/datacenter/datacenter.html");
});

app.get("/admin/config", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/config?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/admin/config.html");
});

app.get("/admin/cache", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/cache?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/admin/cache.html");
});

app.get("/admin/keys", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/keys?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/keys/keys.html");
});

app.get("/chat", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/chat?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/chat/chat.html");
});

app.get("/admin/chat", (c) => {
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`/admin/chat?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, "/chat/chat_admin.html");
});

app.get("/webui", (c) => c.redirect("/webui/login", 302));

async function fetchWebuiPage(c: any, assetPath: string, routePath: string): Promise<Response> {
  const settings = await getSettings(c.env as Env);
  if (!settings.global.webui_enabled) return c.notFound();
  const buildSha = getBuildSha(c.env as Env);
  const v = c.req.query("v") ?? "";
  if (v !== buildSha) return c.redirect(`${routePath}?v=${encodeURIComponent(buildSha)}`, 302);
  return fetchAsset(c, assetPath);
}

app.get("/webui/login", (c) => fetchWebuiPage(c, "/webui/login.html", "/webui/login"));

app.get("/webui/chat", (c) => fetchWebuiPage(c, "/webui/chat.html", "/webui/chat"));

app.get("/webui/masonry", (c) => fetchWebuiPage(c, "/webui/masonry.html", "/webui/masonry"));

app.get("/webui/chatkit", (c) => fetchWebuiPage(c, "/webui/chatkit.html", "/webui/chatkit"));

app.get("/static/*", (c) => {
  const url = new URL(c.req.url);
  if (url.pathname === "/static/_worker.js") return c.notFound();
  if (url.pathname === "/static/token/token.html") {
    return redirectVersionedAdmin(c, "/admin/account");
  }
  if (url.pathname === "/static/config/config.html") {
    return redirectVersionedAdmin(c, "/admin/config");
  }
  if (url.pathname === "/static/cache/cache.html") {
    return redirectVersionedAdmin(c, "/admin/cache");
  }
  url.pathname = url.pathname.replace(/^\/static\//, "/");
  return fetchAsset(c, url.pathname);
});

app.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: "Grok2API",
    runtime: "cloudflare-workers",
    build: { sha: getBuildSha(c.env as Env) },
    bindings: {
      db: Boolean((c.env as any)?.DB),
      kv_cache: Boolean((c.env as any)?.KV_CACHE),
      assets: Boolean(getAssets(c.env as any)),
    },
  }),
);

app.notFound(async (c) => {
  const assets = getAssets(c.env as any);
  const buildSha = getBuildSha(c.env as Env);
  // Avoid calling c.notFound() here because it will invoke this handler again.
  if (!assets) return withResponseHeaders(c.text("Not Found", 404), { "x-grok2api-build": buildSha });
  try {
    const res = await assets.fetch(c.req.raw);
    // Keep the header consistent for debugging/version checks.
    return withResponseHeaders(res, { "x-grok2api-build": buildSha });
  } catch (err) {
    console.error("ASSETS fetch failed (notFound):", err);
    const detail = isDebugRequest(c) ? `\n\n${err instanceof Error ? err.stack || err.message : String(err)}` : "";
    return withResponseHeaders(c.text(`Internal Server Error${detail}`, 500), { "x-grok2api-build": buildSha });
  }
});

const handler: ExportedHandler<Env> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(runKvDailyClear(env));
  },
};

export default handler;
