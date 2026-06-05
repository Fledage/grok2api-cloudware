import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-admin-assets-"));

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

const adminHeaderHtml = readFileSync(join(rootPath, "app/static/admin/header.html"), "utf8");
const adminHeaderJs = readFileSync(join(rootPath, "app/static/js/admin-header.js"), "utf8");
for (const href of ["/admin/token", "/admin/keys", "/admin/chat", "/admin/datacenter", "/admin/config", "/admin/cache"]) {
  assert.ok(adminHeaderHtml.includes(`href="${href}"`), `admin header should link ${href}`);
  assert.ok(adminHeaderJs.includes(`href="${href}"`), `admin header fallback should link ${href}`);
}

const fetchCalls = [];
const originalFetch = globalThis.fetch;

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

  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes("/rest/assets-metadata/")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify({
        assets: [
          {
            id: "asset_1",
            fileName: "cat.png",
            filePath: "/users/u/asset_1/content",
            contentType: "image/png",
            fileSize: 12,
            createdAt: "2026-06-05T01:00:00Z",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const app = await import(pathToFileURL(join(outDir, "src/index.js")));
  const env = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    KV_CACHE: {},
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async first() {
                if (sql.includes("FROM admin_sessions")) return { token: "admin", expires_at: Date.now() + 60_000 };
                if (sql.includes("FROM settings WHERE key = ?")) return null;
                return { c: 0 };
              },
              async all() {
                if (sql.includes("FROM kv_cache GROUP BY type")) return makeResult([]);
                if (sql.includes("FROM tokens ORDER BY created_time DESC")) {
                  return makeResult([
                    {
                      token: "sso_token_1234567890",
                      token_type: "ssoSuper",
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
                  ]);
                }
                return makeResult([]);
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    },
  };
  const ctx = { waitUntil() {} };
  const headers = { Authorization: "Bearer admin" };

  const statsResp = await app.default.fetch(
    new Request("https://worker.example/api/v1/admin/cache?scope=all", { headers }),
    env,
    ctx,
  );
  assert.equal(statsResp.status, 200);
  const stats = await statsResp.json();
  assert.equal(stats.online.status, "ok");
  assert.equal(stats.online.count, 1);
  assert.equal(stats.online_details[0].assets[0].id, "asset_1");

  const clearResp = await app.default.fetch(
    new Request("https://worker.example/api/v1/admin/cache/online/clear", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sso_token_1234567890" }),
    }),
    env,
    ctx,
  );
  assert.equal(clearResp.status, 200);
  const clear = await clearResp.json();
  assert.equal(clear.result.deleted, 1);
  assert.ok(fetchCalls.some((call) => call.init.method === "DELETE"));
} finally {
  globalThis.fetch = originalFetch;
  rmSync(outDir, { recursive: true, force: true });
}
