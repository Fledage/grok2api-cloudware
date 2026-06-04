import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-token-repo-"));

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
  for (const file of walkJsFiles(dir)) {
    const source = readFileSync(file, "utf8");
    const patched = source.replace(
      /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
      (_m, prefix, spec, suffix) => {
        if (/\.(?:js|json|wasm)$/.test(spec)) return `${prefix}${spec}${suffix}`;
        return `${prefix}${spec}.js${suffix}`;
      },
    );
    if (patched !== source) writeFileSync(file, patched);
  }
}

function normalizeToken(raw) {
  const value = String(raw || "").trim();
  return value.startsWith("sso=") ? value.slice(4).trim() : value;
}

function makeDb(rows) {
  const data = rows.map((row) => ({ ...row }));
  return {
    data,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (/COUNT\(1\) as c/i.test(sql)) return countRows(data, sql, params);
              const picked = selectRows(data, sql, params)[0];
              return picked ? { token: picked.token } : null;
            },
            async run() {
              if (/UPDATE tokens SET status = \?/i.test(sql)) {
                const [status, token] = params;
                let changed = 0;
                for (const row of data) {
                  if (row.token === normalizeToken(token)) {
                    row.status = status;
                    changed += 1;
                  }
                }
                return { meta: { changes: changed } };
              }
              if (/UPDATE tokens[\s\S]*SET status = 'active'[\s\S]*failed_count = 0[\s\S]*cooldown_until = NULL/i.test(sql)) {
                const [token] = params;
                let changed = 0;
                for (const row of data) {
                  if (row.token === normalizeToken(token)) {
                    row.status = "active";
                    row.failed_count = 0;
                    row.cooldown_until = null;
                    changed += 1;
                  }
                }
                return { meta: { changes: changed } };
              }
              return { meta: { changes: 0 } };
            },
            async all() {
              return { results: data };
            },
          };
        },
      };
    },
  };
}

function countRows(data, sql, params) {
  let tokenType = "";
  if (/token_type = 'ssoSuper'/i.test(sql)) tokenType = "ssoSuper";
  else if (/token_type = 'sso'/i.test(sql)) tokenType = "sso";
  const filtered = filterAvailable(data, sql, params, tokenType);
  return { c: filtered.length };
}

function selectRows(data, sql, params) {
  const tokenType = String(params[0] || "");
  const filtered = filterAvailable(data, sql, params, tokenType);
  const field = quotaField(sql);
  return filtered.sort((a, b) => {
    const aUnknown = Number(a[field]) === -1 ? 0 : 1;
    const bUnknown = Number(b[field]) === -1 ? 0 : 1;
    if (aUnknown !== bUnknown) return aUnknown - bUnknown;
    const quotaDiff = Number(b[field]) - Number(a[field]);
    if (quotaDiff) return quotaDiff;
    return Number(a.created_time || 0) - Number(b.created_time || 0);
  });
}

function filterAvailable(data, sql, params, tokenType) {
  const field = quotaField(sql);
  const maxFailures = Number(params.find((item) => typeof item === "number") ?? 3);
  const now = Number(params[params.length - 1] ?? Date.now());
  return data.filter((row) => {
    if (tokenType && row.token_type !== tokenType) return false;
    if (/status = 'active'/i.test(sql) && row.status !== "active") return false;
    if (/status != 'expired'/i.test(sql) && row.status === "expired") return false;
    if (Number(row.failed_count || 0) >= maxFailures) return false;
    if (row.cooldown_until !== null && row.cooldown_until !== undefined && Number(row.cooldown_until) > now) return false;
    if (Number(row[field]) === 0) return false;
    return true;
  });
}

function quotaField(sql) {
  return /heavy_remaining_queries\s*!=\s*0/i.test(sql) || /heavy_remaining_queries\s+DESC/i.test(sql)
    ? "heavy_remaining_queries"
    : "remaining_queries";
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

  const tokens = await import(pathToFileURL(join(outDir, "src/repo/tokens.js")));

  const disabledOnly = makeDb([
    {
      token: "disabled-basic",
      token_type: "sso",
      created_time: 1,
      remaining_queries: -1,
      heavy_remaining_queries: -1,
      status: "disabled",
      failed_count: 0,
      cooldown_until: null,
    },
  ]);
  assert.equal(await tokens.selectBestToken(disabledOnly, "grok-imagine-image-lite"), null);
  assert.deepEqual(await tokens.getAvailableTokenPools(disabledOnly), {
    basic: false,
    super: false,
    heavy: false,
  });

  const activeAndDisabled = makeDb([
    {
      token: "disabled-basic",
      token_type: "sso",
      created_time: 1,
      remaining_queries: -1,
      heavy_remaining_queries: -1,
      status: "disabled",
      failed_count: 0,
      cooldown_until: null,
    },
    {
      token: "active-basic",
      token_type: "sso",
      created_time: 2,
      remaining_queries: 5,
      heavy_remaining_queries: -1,
      status: "active",
      failed_count: 0,
      cooldown_until: null,
    },
  ]);
  assert.deepEqual(await tokens.selectBestToken(activeAndDisabled, "grok-imagine-image-lite"), {
    token: "active-basic",
    token_type: "sso",
  });

  assert.equal(await tokens.setTokensDisabled(activeAndDisabled, ["sso=active-basic"], true), 1);
  assert.equal(await tokens.selectBestToken(activeAndDisabled, "grok-imagine-image-lite"), null);
  assert.equal(await tokens.setTokensDisabled(activeAndDisabled, ["active-basic"], false), 1);
  assert.deepEqual(await tokens.selectBestToken(activeAndDisabled, "grok-imagine-image-lite"), {
    token: "active-basic",
    token_type: "sso",
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
