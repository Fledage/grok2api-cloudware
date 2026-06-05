import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-upstream-compat-"));

function walkJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) out.push(...walkJsFiles(file));
    else if (file.endsWith(".js")) out.push(file);
  }
  return out;
}

function patchRelativeImports(dir) {
  const honoImport = pathToFileURL(join(rootPath, "node_modules/hono/dist/index.js")).href;
  const honoCorsImport = pathToFileURL(join(rootPath, "node_modules/hono/dist/middleware/cors/index.js")).href;
  for (const file of walkJsFiles(dir)) {
    const source = readFileSync(file, "utf8");
    let patched = source
      .replace(/(from\s+["'])hono(["'])/g, `$1${honoImport}$2`)
      .replace(/(from\s+["'])hono\/cors(["'])/g, `$1${honoCorsImport}$2`);
    patched = patched.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_m, prefix, spec, suffix) => {
      if (/\.(?:js|json|wasm)$/.test(spec)) return `${prefix}${spec}${suffix}`;
      return `${prefix}${spec}.js${suffix}`;
    });
    if (patched !== source) writeFileSync(file, patched);
  }
}

function makeResult(results) {
  return { results };
}

function makeDb() {
  const state = {
    tokens: [
      {
        token: "basic_token_1234567890",
        token_type: "sso",
        created_time: 1,
        remaining_queries: -1,
        heavy_remaining_queries: -1,
        status: "active",
        tags: "[]",
        note: "",
        cooldown_until: null,
        last_failure_time: null,
        last_failure_reason: null,
        failed_count: 0,
      },
      {
        token: "super_token_1234567890",
        token_type: "ssoSuper",
        created_time: 2,
        remaining_queries: -1,
        heavy_remaining_queries: -1,
        status: "active",
        tags: "[]",
        note: "",
        cooldown_until: null,
        last_failure_time: null,
        last_failure_reason: null,
        failed_count: 0,
      },
    ],
    sessions: new Map([["session-token", Date.now() + 60_000]]),
    settings: new Map(),
    kvDeletes: [],
  };

  return {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes("FROM admin_sessions")) {
                const token = String(params[0] || "");
                const expires = state.sessions.get(token);
                return expires ? { token, expires_at: expires } : null;
              }
              if (sql.includes("FROM settings WHERE key = ?")) {
                const value = state.settings.get(String(params[0] || ""));
                return value ? { value } : null;
              }
              if (sql.includes("COUNT(1) as c FROM api_keys")) return { c: 0 };
              if (sql.includes("COUNT(1) as c FROM tokens") && sql.includes("token_type = 'ssoSuper'") && sql.includes("heavy_remaining_queries")) {
                return { c: state.tokens.filter((t) => t.token_type === "ssoSuper" && t.status === "active" && t.heavy_remaining_queries !== 0).length };
              }
              if (sql.includes("COUNT(1) as c FROM tokens") && sql.includes("token_type = 'ssoSuper'")) {
                return { c: state.tokens.filter((t) => t.token_type === "ssoSuper" && t.status === "active" && t.remaining_queries !== 0).length };
              }
              if (sql.includes("COUNT(1) as c FROM tokens") && sql.includes("token_type = 'sso'")) {
                return { c: state.tokens.filter((t) => t.token_type === "sso" && t.status === "active" && t.remaining_queries !== 0).length };
              }
              if (sql.includes("SELECT token FROM tokens") && sql.includes("ORDER BY")) {
                const requestedType = String(params[0] || "");
                const failureLimit = Number(params[1] ?? 3);
                const now = Number(params[2] ?? Date.now());
                const row = state.tokens.find((t) =>
                  t.token_type === requestedType &&
                  t.status === "active" &&
                  (t.failed_count ?? 0) < failureLimit &&
                  (!t.cooldown_until || t.cooldown_until <= now)
                );
                return row ? { token: row.token } : null;
              }
              if (sql.includes("SELECT COUNT(1) as c FROM request_logs")) return { c: 0 };
              return { c: 0 };
            },
            async all() {
              if (sql.includes("FROM tokens ORDER BY created_time DESC")) return makeResult(state.tokens);
              if (sql.includes("SELECT token, token_type FROM tokens WHERE token IN")) {
                const wanted = new Set(params.map((item) => String(item || "")));
                return makeResult(state.tokens.filter((t) => wanted.has(t.token)).map((t) => ({ token: t.token, token_type: t.token_type })));
              }
              if (sql.includes("FROM kv_cache GROUP BY type")) return makeResult([]);
              if (sql.includes("FROM kv_cache WHERE type = ?")) return makeResult([]);
              if (sql.includes("FROM request_logs")) return makeResult([]);
              return makeResult([]);
            },
            async run() {
              if (sql.includes("INSERT INTO settings")) {
                state.settings.set(String(params[0] || ""), String(params[1] || ""));
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE tokens SET status = ?")) {
                const status = String(params[0] || "");
                const wanted = new Set(params.slice(1).map((item) => String(item || "")));
                let changes = 0;
                for (const row of state.tokens) {
                  if (!wanted.has(row.token)) continue;
                  row.status = status;
                  row.cooldown_until = null;
                  changes += 1;
                }
                return { meta: { changes } };
              }
              if (sql.includes("UPDATE tokens") && sql.includes("SET status = 'active'")) {
                const wanted = new Set(params.map((item) => String(item || "")));
                let changes = 0;
                for (const row of state.tokens) {
                  if (!wanted.has(row.token)) continue;
                  row.status = "active";
                  row.failed_count = 0;
                  row.cooldown_until = null;
                  changes += 1;
                }
                return { meta: { changes } };
              }
              if (sql.includes("UPDATE tokens SET remaining_queries")) {
                const token = String(params.at(-1) || "");
                const row = state.tokens.find((t) => t.token === token);
                if (row) {
                  if (typeof params[0] === "number") row.remaining_queries = params[0];
                  if (typeof params[1] === "number") row.heavy_remaining_queries = params[1];
                }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes("UPDATE tokens SET failed_count = failed_count + 1")) {
                const token = String(params.at(-1) || "");
                const row = state.tokens.find((t) => t.token === token);
                if (row) {
                  row.failed_count += 1;
                  row.last_failure_time = Number(params[0] || 0);
                  row.last_failure_reason = String(params[1] || "");
                }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes("UPDATE tokens SET cooldown_until")) {
                const token = String(params.at(-1) || "");
                const row = state.tokens.find((t) => t.token === token);
                if (row) row.cooldown_until = Number(params[0] || 0) || null;
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes("UPDATE tokens SET status = 'expired'")) {
                const token = String(params.at(-1) || "");
                const row = state.tokens.find((t) => t.token === token);
                if (row) row.status = "expired";
                return { meta: { changes: row ? 1 : 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts) {
      return Promise.all(stmts.map((stmt) => stmt.run()));
    },
  };
}

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "-p",
      "tsconfig.json",
      "--outDir",
      outDir,
      "--rootDir",
      ".",
      "--noEmit",
      "false",
      "--declaration",
      "false",
      "--sourceMap",
      "false",
      "--pretty",
      "false",
    ],
    { cwd: root, stdio: "pipe", shell: process.platform === "win32" },
  );
  patchRelativeImports(outDir);

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const urlText = String(url);
    if (urlText.includes("/rest/livekit/tokens")) {
      const body = JSON.parse(String(init.body || "{}"));
      const session = JSON.parse(body.sessionPayload);
      assert.equal(session.voice, "eve");
      assert.equal(session.playback_speed, 1.25);
      assert.equal(session.instructions, "be concise");
      return new Response(
        JSON.stringify({
          token: "livekit-token",
          livekitUrl: "wss://livekit.grok.com",
          participantName: "participant-a",
          roomName: "room-a",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.includes("api.github.com/repos/chenyme/grok2api/releases")) {
      return new Response(
        JSON.stringify([
          { tag_name: "v9.0.0", name: "draft release", draft: true },
          { tag_name: "not-a-version", name: "invalid release", draft: false },
          {
            tag_name: "v2.0.5",
            name: "v2.0.5",
            html_url: "https://github.com/chenyme/grok2api/releases/tag/v2.0.5",
            published_at: "2026-06-05T00:00:00Z",
            body: "Compatibility release",
            draft: false,
          },
          {
            tag_name: "v2.0.4.rc4",
            name: "v2.0.4.rc4",
            html_url: "https://github.com/chenyme/grok2api/releases/tag/v2.0.4.rc4",
            published_at: "2026-06-04T00:00:00Z",
            body: "Current release",
            draft: false,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.includes("/rest/assets-metadata/")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlText.includes("/rest/assets")) {
      return new Response(
        JSON.stringify({
          assets: [
            { id: "asset_1", fileName: "image.png", filePath: "/users/u/asset_1/content", contentType: "image/png", fileSize: 1 },
            { id: "asset_2", fileName: "video.mp4", filePath: "/users/u/asset_2/content", contentType: "video/mp4", fileSize: 2 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.includes("/rest/rate-limits")) {
      return new Response(JSON.stringify({ remainingQueries: 42, totalQueries: 100 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlText.includes("/rest/app-chat/conversations/new")) {
      return new Response(
        JSON.stringify({ error: { code: 7, message: "Request rejected by anti-bot rules.", details: [] } }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.includes("accounts.x.ai") && urlText.includes("Tos")) {
      return new Response(new Uint8Array([128, 0, 0, 0, 15, 103, 114, 112, 99, 45, 115, 116, 97, 116, 117, 115, 58, 48, 13, 10]), {
        status: 200,
        headers: { "content-type": "application/grpc-web+proto" },
      });
    }
    if (urlText.includes("/rest/auth/set-birth-date")) {
      const body = JSON.parse(String(init.body || "{}"));
      assert.match(String(body.birthDate || ""), /^\d{4}-\d{2}-\d{2}T/);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (urlText.includes("auth_mgmt.AuthManagement/UpdateUserFeatureControls")) {
      return new Response(new Uint8Array([128, 0, 0, 0, 15, 103, 114, 112, 99, 45, 115, 116, 97, 116, 117, 115, 58, 48, 13, 10]), {
        status: 200,
        headers: { "content-type": "application/grpc-web+proto" },
      });
    }
    return originalFetch(url, init);
  };

  try {
    const app = await import(pathToFileURL(join(outDir, "src/index.js")));
    const DB = makeDb();
    const knownAssets = new Set([
      "/login/login.html",
      "/admin/login.html",
      "/admin/account.html",
      "/admin/config.html",
      "/admin/cache.html",
      "/admin/header.html",
      "/chat/chat.html",
      "/chat/chat_admin.html",
      "/token/token.html",
      "/cache/cache.html",
      "/config/config.html",
      "/datacenter/datacenter.html",
      "/keys/keys.html",
      "/webui/login.html",
      "/webui/chat.html",
      "/webui/masonry.html",
      "/webui/chatkit.html",
    ]);
    const env = {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/admin/header.html") {
            return new Response(null, { status: 307, headers: { location: "/admin/header" } });
          }
          if (pathname === "/admin/header") {
            return new Response(
              '<header><a href="https://github.com/chenyme/grok2api">原作者 @Chenyme</a><a href="https://github.com/Fledage/grok2api-cloudware">改造 @Fledage</a><a href="/admin/account">账户管理</a><a href="/admin/keys">API Key 管理</a><a href="/admin/chat">在线聊天</a><a href="/admin/datacenter">数据中心</a><a href="/admin/config">配置管理</a><a href="/admin/cache">缓存管理</a></header>',
              { status: 200 },
            );
          }
          const htmlAssetMap = {
            "/admin/account.html": "/admin/account",
            "/admin/config.html": "/admin/config",
            "/admin/cache.html": "/admin/cache",
            "/keys/keys.html": "/keys/keys",
            "/chat/chat_admin.html": "/chat/chat_admin",
            "/datacenter/datacenter.html": "/datacenter/datacenter",
          };
          if (pathname in htmlAssetMap) {
            return new Response(null, { status: 307, headers: { location: htmlAssetMap[pathname] } });
          }
          if (Object.values(htmlAssetMap).includes(pathname)) {
            return new Response(`${pathname}<div id="admin-header" data-active="/admin/account"></div>`, { status: 200 });
          }
          return knownAssets.has(pathname)
            ? new Response(pathname, { status: 200 })
            : new Response("missing", { status: 404 });
        },
      },
      KV_CACHE: { delete: async (key) => DB.state.kvDeletes.push(key) },
      DB,
    };
    const ctx = { waitUntil(promise) { return promise; } };
    const adminHeaders = { Authorization: "Bearer session-token" };

    const metaResp = await app.default.fetch(new Request("https://worker.example/meta"), env, ctx);
    assert.equal(metaResp.status, 200);
    const meta = await metaResp.json();
    assert.equal(meta.version, "2.0.4.rc4");

    const updateResp = await app.default.fetch(new Request("https://worker.example/meta/update?force=true"), env, ctx);
    assert.equal(updateResp.status, 200);
    const update = await updateResp.json();
    assert.equal(update.current_version, "2.0.4.rc4");
    assert.equal(update.latest_version, "2.0.5");
    assert.equal(update.update_available, true);
    assert.equal(update.status, "ok");
    assert.equal(fetchCalls.some((call) => call.url.includes("api.github.com/repos/chenyme/grok2api/releases")), true);

    const webuiRoot = await app.default.fetch(new Request("https://worker.example/webui"), env, ctx);
    assert.equal(webuiRoot.status, 302);
    assert.equal(webuiRoot.headers.get("location"), "/webui/login");

    const webuiChat = await app.default.fetch(new Request("https://worker.example/webui/chat"), env, ctx);
    assert.equal(webuiChat.status, 302);
    assert.equal(webuiChat.headers.get("location"), "/webui/chat?v=dev");
    const webuiChatPage = await app.default.fetch(new Request("https://worker.example/webui/chat?v=dev"), env, ctx);
    assert.equal(webuiChatPage.status, 200);

    const adminRoot = await app.default.fetch(new Request("https://worker.example/admin"), env, ctx);
    assert.equal(adminRoot.status, 302);
    assert.equal(adminRoot.headers.get("location"), "/admin/login");
    const legacyLogin = await app.default.fetch(new Request("https://worker.example/login"), env, ctx);
    assert.equal(legacyLogin.status, 302);
    assert.equal(legacyLogin.headers.get("location"), "/admin/login?v=dev");
    const adminLogin = await app.default.fetch(new Request("https://worker.example/admin/login"), env, ctx);
    assert.equal(adminLogin.status, 302);
    assert.equal(adminLogin.headers.get("location"), "/admin/login?v=dev");
    const adminLoginPage = await app.default.fetch(new Request("https://worker.example/admin/login?v=dev"), env, ctx);
    assert.equal(adminLoginPage.status, 200);
    assert.equal(await adminLoginPage.text(), "/admin/login.html");
    const adminAccount = await app.default.fetch(new Request("https://worker.example/admin/account"), env, ctx);
    assert.equal(adminAccount.status, 302);
    assert.equal(adminAccount.headers.get("location"), "/admin/account?v=dev");
    const adminAccountPage = await app.default.fetch(new Request("https://worker.example/admin/account?v=dev"), env, ctx);
    assert.equal(adminAccountPage.status, 200);
    const adminAccountHtml = await adminAccountPage.text();
    assert.match(adminAccountHtml, /\/admin\/account(?:\.html)?/);
    assert.ok(adminAccountHtml.includes("原作者 @Chenyme"));
    assert.ok(adminAccountHtml.includes("改造 @Fledage"));
    assert.ok(adminAccountHtml.includes('href="/admin/keys"'));
    const legacyManage = await app.default.fetch(new Request("https://worker.example/manage"), env, ctx);
    assert.equal(legacyManage.status, 302);
    assert.equal(legacyManage.headers.get("location"), "/admin/account?v=dev");
    const legacyToken = await app.default.fetch(new Request("https://worker.example/admin/token"), env, ctx);
    assert.equal(legacyToken.status, 302);
    assert.equal(legacyToken.headers.get("location"), "/admin/account?v=dev");
    const legacyTokenVersioned = await app.default.fetch(new Request("https://worker.example/admin/token?v=dev"), env, ctx);
    assert.equal(legacyTokenVersioned.status, 302);
    assert.equal(legacyTokenVersioned.headers.get("location"), "/admin/account?v=dev");
    const legacyStaticToken = await app.default.fetch(new Request("https://worker.example/static/token/token.html"), env, ctx);
    assert.equal(legacyStaticToken.status, 302);
    assert.equal(legacyStaticToken.headers.get("location"), "/admin/account?v=dev");
    const legacyAssetToken = await app.default.fetch(new Request("https://worker.example/token/token.html"), env, ctx);
    assert.equal(legacyAssetToken.status, 302);
    assert.equal(legacyAssetToken.headers.get("location"), "/admin/account?v=dev");
    const legacyTokenRoot = await app.default.fetch(new Request("https://worker.example/token"), env, ctx);
    assert.equal(legacyTokenRoot.status, 302);
    assert.equal(legacyTokenRoot.headers.get("location"), "/admin/account?v=dev");
    const legacyStaticConfig = await app.default.fetch(new Request("https://worker.example/static/config/config.html"), env, ctx);
    assert.equal(legacyStaticConfig.status, 302);
    assert.equal(legacyStaticConfig.headers.get("location"), "/admin/config?v=dev");
    const legacyAssetConfig = await app.default.fetch(new Request("https://worker.example/config/config.html"), env, ctx);
    assert.equal(legacyAssetConfig.status, 302);
    assert.equal(legacyAssetConfig.headers.get("location"), "/admin/config?v=dev");
    const legacyConfigRoot = await app.default.fetch(new Request("https://worker.example/config"), env, ctx);
    assert.equal(legacyConfigRoot.status, 302);
    assert.equal(legacyConfigRoot.headers.get("location"), "/admin/config?v=dev");
    const legacyStaticCache = await app.default.fetch(new Request("https://worker.example/static/cache/cache.html"), env, ctx);
    assert.equal(legacyStaticCache.status, 302);
    assert.equal(legacyStaticCache.headers.get("location"), "/admin/cache?v=dev");
    const legacyAssetCache = await app.default.fetch(new Request("https://worker.example/cache/cache.html"), env, ctx);
    assert.equal(legacyAssetCache.status, 302);
    assert.equal(legacyAssetCache.headers.get("location"), "/admin/cache?v=dev");
    const legacyCacheRoot = await app.default.fetch(new Request("https://worker.example/cache"), env, ctx);
    assert.equal(legacyCacheRoot.status, 302);
    assert.equal(legacyCacheRoot.headers.get("location"), "/admin/cache?v=dev");
    const adminConfigPage = await app.default.fetch(new Request("https://worker.example/admin/config?v=dev"), env, ctx);
    assert.equal(adminConfigPage.status, 200);
    assert.match(await adminConfigPage.text(), /\/admin\/config(?:\.html)?/);
    const adminCachePage = await app.default.fetch(new Request("https://worker.example/admin/cache?v=dev"), env, ctx);
    assert.equal(adminCachePage.status, 200);
    assert.match(await adminCachePage.text(), /\/admin\/cache(?:\.html)?/);
    const adminKeysPage = await app.default.fetch(new Request("https://worker.example/admin/keys?v=dev"), env, ctx);
    assert.equal(adminKeysPage.status, 200);
    assert.match(await adminKeysPage.text(), /\/keys\/keys(?:\.html)?/);
    const adminChatPage = await app.default.fetch(new Request("https://worker.example/admin/chat?v=dev"), env, ctx);
    assert.equal(adminChatPage.status, 200);
    assert.match(await adminChatPage.text(), /\/chat\/chat_admin(?:\.html)?/);
    const adminDatacenterPage = await app.default.fetch(new Request("https://worker.example/admin/datacenter?v=dev"), env, ctx);
    assert.equal(adminDatacenterPage.status, 200);
    assert.match(await adminDatacenterPage.text(), /\/datacenter\/datacenter(?:\.html)?/);

    const verify = await app.default.fetch(new Request("https://worker.example/webui/api/verify"), env, ctx);
    assert.equal(verify.status, 200);

    const adminVerifyByAppKey = await app.default.fetch(new Request("https://worker.example/admin/api/verify?app_key=admin"), env, ctx);
    assert.equal(adminVerifyByAppKey.status, 200);

    const adminSyncResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/sync?app_key=admin", { method: "POST" }),
      env,
      ctx,
    );
    assert.equal(adminSyncResp.status, 200);
    const adminSync = await adminSyncResp.json();
    assert.equal(adminSync.changed, false);
    assert.equal(typeof adminSync.revision, "number");

    const adminStatusResp = await app.default.fetch(new Request("https://worker.example/admin/api/status?app_key=admin"), env, ctx);
    assert.equal(adminStatusResp.status, 200);
    const adminStatus = await adminStatusResp.json();
    assert.equal(adminStatus.selection_strategy, "quota");

    const batchStreamByAppKey = await app.default.fetch(new Request("https://worker.example/admin/api/batch/task_1/stream?app_key=admin"), env, ctx);
    assert.equal(batchStreamByAppKey.status, 200);

    const upstreamConfigAliasResp = await app.default.fetch(new Request("https://worker.example/admin/api/config?app_key=admin"), env, ctx);
    assert.equal(upstreamConfigAliasResp.status, 200);
    const upstreamConfigAlias = await upstreamConfigAliasResp.json();
    assert.equal(upstreamConfigAlias.app.webui_enabled, true);
    assert.equal(upstreamConfigAlias.features.thinking, true);
    assert.equal(upstreamConfigAlias.features.stream, false);
    assert.equal(upstreamConfigAlias.retry.on_codes, "401,429,403");

    const modelsResp = await app.default.fetch(new Request("https://worker.example/webui/api/models"), env, ctx);
    assert.equal(modelsResp.status, 200);
    const models = await modelsResp.json();
    const ids = models.data.map((item) => item.id);
    assert.ok(ids.includes("grok-imagine-image"));
    assert.ok(ids.includes("grok-imagine-video"));
    assert.ok(!ids.includes("definitely-not-a-model"));
    assert.equal(models.data.find((item) => item.id === "grok-imagine-video").capability, "video");

    const configBeforeResp = await app.default.fetch(new Request("https://worker.example/api/v1/admin/config", { headers: adminHeaders }), env, ctx);
    assert.equal(configBeforeResp.status, 200);
    const configBefore = await configBeforeResp.json();
    assert.equal(configBefore.grok.imagine_public_image_proxy, false);
    assert.equal(configBefore.app.webui_enabled, true);
    assert.equal(configBefore.app.webui_key, "");

    const newConfigUpdateResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/config?app_key=admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: {
            thinking: false,
            temporary: false,
            stream: true,
            dynamic_statsig: true,
            image_format: "base64",
            imagine_public_image_proxy: true,
          },
          logging: { file_level: "DEBUG" },
          retry: { on_codes: "403,429" },
          chat: { timeout: 321 },
          image: { stream_timeout: 77 },
          account: { refresh: { enabled: false, basic_interval_sec: 7200, on_demand_min_interval_sec: 55, usage_concurrency: 12 } },
          batch: { asset_delete_concurrency: 13 },
          cache: { local: { image_max_mb: 333, video_max_mb: 444 } },
        }),
      }),
      env,
      ctx,
    );
    assert.equal(newConfigUpdateResp.status, 200);
    const savedGrok = JSON.parse(DB.state.settings.get("grok"));
    assert.equal(savedGrok.show_thinking, false);
    assert.equal(savedGrok.temporary, false);
    assert.equal(savedGrok.stream, true);
    assert.equal(savedGrok.dynamic_statsig, true);
    assert.equal(savedGrok.imagine_public_image_proxy, true);
    assert.deepEqual(savedGrok.retry_status_codes, [403, 429]);
    assert.equal(savedGrok.stream_total_timeout, 321);
    assert.equal(savedGrok.stream_chunk_timeout, 77);
    const savedGlobal = JSON.parse(DB.state.settings.get("global"));
    assert.equal(savedGlobal.image_mode, "base64");
    assert.equal(savedGlobal.log_level, "DEBUG");
    assert.equal(savedGlobal.image_cache_max_size_mb, 333);
    assert.equal(savedGlobal.video_cache_max_size_mb, 444);
    const savedToken = JSON.parse(DB.state.settings.get("token"));
    assert.equal(savedToken.auto_refresh, false);
    assert.equal(savedToken.refresh_interval_hours, 2);
    assert.equal(savedToken.reload_interval_sec, 55);
    const savedPerformance = JSON.parse(DB.state.settings.get("performance"));
    assert.equal(savedPerformance.usage_max_concurrent, 12);
    assert.equal(savedPerformance.assets_delete_batch_size, 13);

    const newConfigAfterResp = await app.default.fetch(new Request("https://worker.example/admin/api/config?app_key=admin"), env, ctx);
    assert.equal(newConfigAfterResp.status, 200);
    const newConfigAfter = await newConfigAfterResp.json();
    assert.equal(newConfigAfter.features.thinking, false);
    assert.equal(newConfigAfter.features.temporary, false);
    assert.equal(newConfigAfter.features.stream, true);
    assert.equal(newConfigAfter.features.image_format, "base64");
    assert.equal(newConfigAfter.retry.on_codes, "403,429");

    const configUpdateResp = await app.default.fetch(
      new Request("https://worker.example/api/v1/admin/config", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ app: { webui_enabled: true, webui_key: "webui-secret" }, grok: { imagine_public_image_proxy: true } }),
      }),
      env,
      ctx,
    );
    assert.equal(configUpdateResp.status, 200);
    assert.equal(JSON.parse(DB.state.settings.get("grok")).imagine_public_image_proxy, true);
    assert.equal(JSON.parse(DB.state.settings.get("global")).webui_enabled, true);
    assert.equal(JSON.parse(DB.state.settings.get("global")).webui_key, "webui-secret");

    const upstreamConfigAliasUpdateResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/config?app_key=admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: { webui_key: "alias-secret" } }),
      }),
      env,
      ctx,
    );
    assert.equal(upstreamConfigAliasUpdateResp.status, 200);
    assert.equal(JSON.parse(DB.state.settings.get("global")).webui_key, "alias-secret");

    const resetAliasKeyResp = await app.default.fetch(
      new Request("https://worker.example/api/v1/admin/config", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ app: { webui_key: "webui-secret" } }),
      }),
      env,
      ctx,
    );
    assert.equal(resetAliasKeyResp.status, 200);

    const webuiVerifyWithoutKey = await app.default.fetch(new Request("https://worker.example/webui/api/verify"), env, ctx);
    assert.equal(webuiVerifyWithoutKey.status, 401);
    const webuiVerifyWithKey = await app.default.fetch(
      new Request("https://worker.example/webui/api/verify", { headers: { Authorization: "Bearer webui-secret" } }),
      env,
      ctx,
    );
    assert.equal(webuiVerifyWithKey.status, 200);

    const configDisableWebuiResp = await app.default.fetch(
      new Request("https://worker.example/api/v1/admin/config", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ app: { webui_enabled: false } }),
      }),
      env,
      ctx,
    );
    assert.equal(configDisableWebuiResp.status, 200);
    const disabledWebuiPage = await app.default.fetch(new Request("https://worker.example/webui/chat?v=dev"), env, ctx);
    assert.equal(disabledWebuiPage.status, 404);
    const disabledWebuiApi = await app.default.fetch(
      new Request("https://worker.example/webui/api/verify", { headers: { Authorization: "Bearer webui-secret" } }),
      env,
      ctx,
    );
    assert.equal(disabledWebuiApi.status, 401);
    const configReenableWebuiResp = await app.default.fetch(
      new Request("https://worker.example/api/v1/admin/config", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ app: { webui_enabled: true, webui_key: "" } }),
      }),
      env,
      ctx,
    );
    assert.equal(configReenableWebuiResp.status, 200);

    const disabledResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/tokens/disabled/batch", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: ["basic_token_1234567890"], disabled: true }),
      }),
      env,
      ctx,
    );
    assert.equal(disabledResp.status, 200);
    const disabled = await disabledResp.json();
    assert.equal(disabled.status, "success");
    assert.equal(disabled.summary.ok, 1);
    assert.equal(DB.state.tokens.find((t) => t.token === "basic_token_1234567890").status, "disabled");

    const voiceResp = await app.default.fetch(
      new Request("https://worker.example/webui/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: "eve", speed: 1.25, instruction: "be concise" }),
      }),
      env,
      ctx,
    );
    assert.equal(voiceResp.status, 200);
    const voice = await voiceResp.json();
    assert.equal(voice.token, "livekit-token");
    assert.equal(voice.participant_name, "participant-a");
    assert.equal(voice.room_name, "room-a");

    const batchClearResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/batch/cache-clear", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: ["super_token_1234567890"] }),
      }),
      env,
      ctx,
    );
    assert.equal(batchClearResp.status, 200);
    const batchClear = await batchClearResp.json();
    assert.equal(batchClear.status, "success");
    assert.equal(batchClear.summary.ok, 1);
    assert.equal(batchClear.results["super_to...34567890"].deleted, 2);

    const nsfwResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/batch/nsfw", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: ["super_token_1234567890"] }),
      }),
      env,
      ctx,
    );
    assert.equal(nsfwResp.status, 200);
    const nsfw = await nsfwResp.json();
    assert.equal(nsfw.status, "success");
    assert.equal(nsfw.supported, true);
    assert.equal(nsfw.summary.ok, 1);
    assert.equal(fetchCalls.some((call) => call.url.includes("/rest/auth/set-birth-date")), true);
    assert.equal(fetchCalls.some((call) => call.url.includes("auth_mgmt.AuthManagement/UpdateUserFeatureControls")), true);

    const beforeDisableCalls = fetchCalls.length;
    const nsfwDisableResp = await app.default.fetch(
      new Request("https://worker.example/admin/api/batch/nsfw?enabled=false", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: ["super_token_1234567890"] }),
      }),
      env,
      ctx,
    );
    assert.equal(nsfwDisableResp.status, 200);
    const nsfwDisable = await nsfwDisableResp.json();
    assert.equal(nsfwDisable.status, "success");
    assert.equal(nsfwDisable.supported, true);
    assert.equal(nsfwDisable.summary.ok, 1);
    const disableCalls = fetchCalls.slice(beforeDisableCalls);
    assert.equal(disableCalls.some((call) => call.url.includes("/rest/auth/set-birth-date")), false);
    assert.equal(disableCalls.some((call) => call.url.includes("auth_mgmt.AuthManagement/UpdateUserFeatureControls")), true);

    const assetsResp = await app.default.fetch(new Request("https://worker.example/admin/api/assets", { headers: adminHeaders }), env, ctx);
    assert.equal(assetsResp.status, 200);
    const assets = await assetsResp.json();
    assert.equal(assets.total_assets, 2);
    assert.equal(assets.tokens[0].assets[0].id, "asset_1");

    for (const token of DB.state.tokens) {
      token.status = "active";
      token.failed_count = 0;
      token.cooldown_until = null;
    }
    const priorFetchCount = fetchCalls.length;
    const imageAntiBotResp = await app.default.fetch(
      new Request("https://worker.example/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-imagine-image-lite",
          prompt: "cat",
          n: 1,
        }),
      }),
      env,
      ctx,
    );
    assert.equal(imageAntiBotResp.status, 403);
    const imageAntiBot = await imageAntiBotResp.json();
    assert.equal(imageAntiBot.error.code, "upstream_antibot");
    assert.match(imageAntiBot.error.message, /Worker egress|anti-bot/i);
    assert.equal(
      fetchCalls.slice(priorFetchCount).filter((call) => String(call.url).includes("/rest/app-chat/conversations/new")).length,
      2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
