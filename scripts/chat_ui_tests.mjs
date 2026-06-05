import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/static/chat/chat.js", import.meta.url), "utf8");

function makeElement() {
  return {
    className: "",
    dataset: {},
    style: {},
    children: [],
    innerHTML: "",
    textContent: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    remove() {
      this.removed = true;
    },
    querySelector() {
      return makeElement();
    },
    addEventListener() {},
  };
}

function makeSseResponse(blocks) {
  const encoded = blocks.map((block) => new TextEncoder().encode(block));
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encoded.length) return { done: true };
            return { done: false, value: encoded[index++] };
          },
        };
      },
    },
    async text() {
      return "";
    },
  };
}

const context = {
  assert,
  console,
  TextDecoder,
  TextEncoder,
  setInterval() {
    return 0;
  },
  clearInterval() {},
  setTimeout() {
    return 0;
  },
  clearTimeout() {},
  localStorage: {
    getItem() {
      return "";
    },
    setItem() {},
    removeItem() {},
  },
  window: {
    __CHAT_ADMIN__: false,
    location: { href: "https://worker.example/chat" },
    addEventListener() {},
  },
  document: {
    readyState: "loading",
    addEventListener() {},
    getElementById(id) {
      if (id === "image-results") return context.__imageResults;
      return makeElement();
    },
    createElement() {
      return makeElement();
    },
    querySelectorAll() {
      return [];
    },
  },
  fetch: async () =>
    makeSseResponse([
      'event: image_generation.error\ndata: {"type":"image_generation.error","message":"Imagine websocket connect failed: 403 anti-bot"}\n\n',
      "data: [DONE]\n\n",
    ]),
  __imageResults: makeElement(),
};
context.globalThis = context;

const tests = `
(async () => {
  let error = null;
  try {
    await streamImage({ prompt: "cat", model: "grok-imagine-image", n: 1 }, { Authorization: "Bearer test" });
  } catch (e) {
    error = e;
  }
  assert.ok(error);
  assert.equal(error.message, "Imagine websocket connect failed: 403 anti-bot");
})();
`;

await vm.runInNewContext(`${source}\n${tests}`, context);
