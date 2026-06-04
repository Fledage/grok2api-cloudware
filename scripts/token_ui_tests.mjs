import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/static/token/token.js", import.meta.url), "utf8");

const context = {
  assert,
  console,
  setInterval() {
    return 0;
  },
  clearInterval() {},
  setTimeout() {
    return 0;
  },
  requestAnimationFrame(fn) {
    if (typeof fn === "function") fn();
  },
  fetch: async (url, options = {}) => {
    context.__fetches.push({ url, options });
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  },
  __fetches: [],
  buildAuthHeaders() {
    return {};
  },
  showToast() {},
  window: {
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
  },
  document: {
    readyState: "loading",
    addEventListener() {},
    getElementById() {
      return null;
    },
    createElement() {
      return {
        click() {},
      };
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
  },
  Blob: class Blob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  },
};
context.globalThis = context;

const tests = `
(() => {
  const txt = parseTextTokens("sso=basic-token\\n\\nplain-token", "ssoBasic");
  assert.equal(txt.length, 2);
  assert.equal(txt[0].token, "basic-token");
  assert.equal(txt[0].pool, "ssoBasic");
  assert.equal(txt[0].quota, -1);
  assert.equal(txt[0].quota_known, false);
  assert.equal(txt[0].heavy_quota, -1);
  assert.equal(txt[0].heavy_quota_known, false);

  const imported = parseJsonImport(JSON.stringify({
    ssoBasic: [{ token: "sso=basic-json", quota: 12 }],
    heavy: ["sso=super-json"],
  }), "ssoBasic");
  assert.equal(imported.length, 2);
  assert.equal(imported[0].pool, "ssoBasic");
  assert.equal(imported[0].quota, 12);
  assert.equal(imported[1].pool, "ssoSuper");
  assert.equal(imported[1].token_type, "ssoSuper");
  assert.equal(imported[1].quota, -1);

  flatTokens = imported;
  const exported = exportPayload();
  assert.deepEqual(exported.ssoBasic.map((item) => item.token), ["basic-json"]);
  assert.deepEqual(exported.ssoSuper.map((item) => item.token), ["super-json"]);
  assert.equal(exported.ssoSuper[0].quota, -1);

  assert.equal(tokenStatusLabel({ status: "disabled", quota_known: false }), "disabled");
  assert.equal(isTokenActive({ status: "disabled", quota_known: false }), false);

  apiKey = "test-admin-key";
  batchQueue = ["basic-json", "super-json"];
  batchTotal = 2;
  batchProcessed = 0;
  isBatchProcessing = true;
  isBatchPaused = false;
  currentBatchAction = "disable";
  return processDisabledQueue().then(() => {
    assert.equal(batchProcessed, 2);
    const req = __fetches.find((item) => String(item.url).includes("/tokens/disabled"));
    assert.ok(req);
    assert.deepEqual(JSON.parse(req.options.body), { tokens: ["basic-json", "super-json"], disabled: true });
  });
})();
`;

await vm.runInNewContext(`${source}\n${tests}`, context);
