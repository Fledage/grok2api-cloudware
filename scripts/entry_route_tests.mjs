import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const rootPath = fileURLToPath(root);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-entry-"));

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
    patched = patched.replace(
        /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
        (_m, prefix, spec, suffix) => {
          if (/\.(?:js|json|wasm)$/.test(spec)) return `${prefix}${spec}${suffix}`;
          return `${prefix}${spec}.js${suffix}`;
        },
      );
    if (patched !== source) writeFileSync(file, patched);
  }
}

const env = {
  tokenRows: [],
  DB: {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes("SELECT token FROM tokens") && sql.includes("ORDER BY")) {
                const requestedType = String(params[0] || "");
                const row = env.tokenRows.find((t) => t.token_type === requestedType && t.status === "active");
                return row ? { token: row.token } : null;
              }
              return { c: 0 };
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  },
  KV_CACHE: {
    async getWithMetadata() {
      return null;
    },
    async put() {},
  },
  ASSETS: {
    fetch: async () => new Response("asset", { status: 200 }),
  },
  CACHE_RESET_TZ_OFFSET_MINUTES: "480",
  KV_CACHE_MAX_BYTES: "26214400",
};

const ctx = {
  waitUntil() {},
};

async function assertRedirect(path, expected) {
  const app = await import(pathToFileURL(join(outDir, "src/index.js")));
  const resp = await app.default.fetch(new Request(`https://worker.example${path}`), env, ctx);
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get("location"), expected);
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

  await assertRedirect("/v1/files/image?id=u_abc", "/images/u_abc");
  await assertRedirect("/v1/files/video?id=p_def", "/images/p_def");
  await assertRedirect("/v1/files/image/u_legacy", "/images/u_legacy");

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response("image-bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "11" },
    });
  };
  try {
    const fullUrl = "https://assets.grok.com/users/demo/generated/image.jpg";
    const encoded = btoa(fullUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const app = await import(pathToFileURL(join(outDir, "src/index.js")));
    const resp = await app.default.fetch(new Request(`https://worker.example/images/u_${encoded}`), env, ctx);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), "image-bytes");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, fullUrl);
    assert.equal(Boolean(calls[0].init.headers?.Cookie), false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const fallbackCalls = [];
  env.tokenRows = [
    {
      token: "basic_token_1234567890",
      token_type: "sso",
      status: "active",
      remaining_queries: -1,
      heavy_remaining_queries: -1,
    },
  ];
  globalThis.fetch = async (url, init = {}) => {
    fallbackCalls.push({ url: String(url), init });
    if (fallbackCalls.length === 1) return new Response("forbidden", { status: 403 });
    return new Response("private-image", {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "13" },
    });
  };
  try {
    const fullUrl = "https://assets.grok.com/users/demo/generated/private.jpg";
    const encoded = btoa(fullUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const app = await import(pathToFileURL(join(outDir, "src/index.js")));
    const resp = await app.default.fetch(new Request(`https://worker.example/images/u_${encoded}`), env, ctx);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), "private-image");
    assert.equal(fallbackCalls.length, 2);
    assert.equal(Boolean(fallbackCalls[0].init.headers?.Cookie), false);
    assert.match(String(fallbackCalls[1].init.headers?.Cookie ?? ""), /sso=basic_token_1234567890/);
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
