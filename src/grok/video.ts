export const VIDEO_MODEL_ID = "grok-imagine-video";
export const VIDEO_QUALITY = "standard";

const VIDEO_SIZE_MAP: Record<string, { aspectRatio: string; resolutionName: "480p" | "720p" }> = {
  "720x1280": { aspectRatio: "9:16", resolutionName: "720p" },
  "1280x720": { aspectRatio: "16:9", resolutionName: "720p" },
  "1024x1024": { aspectRatio: "1:1", resolutionName: "720p" },
  "1024x1792": { aspectRatio: "9:16", resolutionName: "720p" },
  "1792x1024": { aspectRatio: "16:9", resolutionName: "720p" },
};

const SUPPORTED_SECONDS = new Set([6, 10, 12, 16, 20]);
const PRESETS = new Set(["fun", "normal", "spicy", "custom"]);

export function resolveVideoSize(size: unknown): { aspectRatio: string; resolutionName: "480p" | "720p" } {
  const normalized = String(size ?? "720x1280").trim() || "720x1280";
  const resolved = VIDEO_SIZE_MAP[normalized];
  if (!resolved) {
    throw new Error(`size must be one of [${Object.keys(VIDEO_SIZE_MAP).join(", ")}]`);
  }
  return resolved;
}

export function resolveVideoSeconds(seconds: unknown): number {
  const raw = seconds === undefined || seconds === null || String(seconds).trim() === "" ? 6 : Number(seconds);
  const value = Number.isFinite(raw) ? Math.floor(raw) : NaN;
  if (!SUPPORTED_SECONDS.has(value)) {
    throw new Error(`seconds must be one of [${[...SUPPORTED_SECONDS].join(", ")}]`);
  }
  return value;
}

export function resolveVideoResolutionName(input: unknown, fallback: "480p" | "720p" = "720p"): "480p" | "720p" {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "480p" || value === "sd") return "480p";
  if (value === "720p" || value === "hd") return "720p";
  return fallback;
}

export function normalizeVideoPreset(input: unknown): "fun" | "normal" | "spicy" | "custom" {
  const value = String(input ?? "custom").trim().toLowerCase();
  return PRESETS.has(value) ? (value as "fun" | "normal" | "spicy" | "custom") : "custom";
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractVideoUrlFromText(content: unknown): string {
  const text = String(content ?? "");
  const srcMatch = text.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (srcMatch?.[1]) return htmlUnescape(srcMatch[1]);
  const hrefMatch = text.match(/<a\b[^>]*\bhref=["']([^"']+)["']/i);
  if (hrefMatch?.[1]) return htmlUnescape(hrefMatch[1]);
  const plainMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  return plainMatch?.[0] ? htmlUnescape(plainMatch[0]) : "";
}

export function extractVideoUrlFromChatCompletion(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  if (!Array.isArray(choices)) return "";
  for (const choice of choices) {
    const url = extractVideoUrlFromText(choice?.message?.content);
    if (url) return url;
  }
  return "";
}
