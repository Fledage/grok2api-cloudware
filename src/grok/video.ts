export const VIDEO_MODEL_ID = "grok-imagine-video";
export const VIDEO_QUALITY = "standard";
const GROK_ASSET_ORIGIN = "https://assets.grok.com";

const VIDEO_SIZE_MAP: Record<string, { aspectRatio: string; resolutionName: "480p" | "720p" }> = {
  "720x1280": { aspectRatio: "9:16", resolutionName: "720p" },
  "1280x720": { aspectRatio: "16:9", resolutionName: "720p" },
  "1024x1024": { aspectRatio: "1:1", resolutionName: "720p" },
  "1024x1792": { aspectRatio: "9:16", resolutionName: "720p" },
  "1792x1024": { aspectRatio: "16:9", resolutionName: "720p" },
};

const SUPPORTED_SECONDS = new Set([6, 10, 12, 16, 20]);
const PRESETS = new Set(["fun", "normal", "spicy", "custom"]);
const VIDEO_EXTENSION_REF_TYPE = "ORIGINAL_REF_TYPE_VIDEO_EXTENSION";

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
  buildVideoSegmentLengths(value);
  return value;
}

export function buildVideoSegmentLengths(seconds: number): number[] {
  if (seconds === 6) return [6];
  if (seconds === 10) return [10];
  if (seconds === 12) return [6, 6];
  if (seconds === 16) return [10, 6];
  if (seconds === 20) return [10, 10];
  throw new Error(`seconds must be one of [${[...SUPPORTED_SECONDS].join(", ")}]`);
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

function videoPresetFlag(preset: "fun" | "normal" | "spicy" | "custom"): string {
  if (preset === "fun") return "--mode=extremely-crazy";
  if (preset === "normal") return "--mode=normal";
  if (preset === "spicy") return "--mode=extremely-spicy-or-crazy";
  return "--mode=custom";
}

function buildVideoMessage(prompt: string, preset: "fun" | "normal" | "spicy" | "custom"): string {
  return `${String(prompt || "").trim()} ${videoPresetFlag(preset)}`.trim();
}

export function videoExtendStartTime(seconds: number): number {
  return Math.round((Number(seconds || 0) + 1 / 24) * 1_000_000) / 1_000_000;
}

export function buildVideoExtendPayload(args: {
  prompt: string;
  parentPostId: string;
  extendPostId: string;
  aspectRatio: string;
  resolutionName: "480p" | "720p";
  videoLength: number;
  preset: "fun" | "normal" | "spicy" | "custom";
  startTimeSeconds: number;
}): Record<string, unknown> {
  return {
    temporary: true,
    modelName: "imagine-video-gen",
    message: buildVideoMessage(args.prompt, args.preset),
    enableSideBySide: true,
    responseMetadata: {
      experiments: [],
      modelConfigOverride: {
        modelMap: {
          videoGenModelConfig: {
            isVideoExtension: true,
            videoExtensionStartTime: args.startTimeSeconds,
            extendPostId: args.extendPostId,
            stitchWithExtendPostId: true,
            originalPrompt: args.prompt,
            originalPostId: args.parentPostId,
            originalRefType: VIDEO_EXTENSION_REF_TYPE,
            mode: args.preset,
            aspectRatio: args.aspectRatio,
            videoLength: args.videoLength,
            resolutionName: args.resolutionName,
            parentPostId: args.parentPostId,
            isVideoEdit: false,
          },
        },
      },
    },
  };
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : null;
}

function extractCookieValue(cookie: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function normalizeGrokAssetUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = input.trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).toString();
    } catch {
      return "";
    }
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${GROK_ASSET_ORIGIN}${path.replace(/\/{2,}/g, "/")}`;
}

function resolveAssetContentUrl(assetId: unknown, cookie = ""): string {
  if (typeof assetId !== "string") return "";
  const id = assetId.trim();
  if (!id) return "";
  const userId = extractCookieValue(cookie, "x-userid");
  if (!userId) return "";
  return `${GROK_ASSET_ORIGIN}/users/${encodeURIComponent(userId)}/${encodeURIComponent(id)}/content`;
}

export type VideoArtifactInfo = {
  videoUrl: string;
  thumbnailUrl: string;
  videoPostId: string;
  assetId: string;
};

export function extractResponseVideoArtifact(response: unknown, cookie = ""): VideoArtifactInfo {
  const resp = asRecord(response);
  const stream = asRecord(resp?.streamingVideoGenerationResponse);
  const modelResponse = asRecord(resp?.modelResponse);
  const out: VideoArtifactInfo = {
    videoUrl: "",
    thumbnailUrl: "",
    videoPostId: "",
    assetId: "",
  };

  if (stream) {
    const progressRaw = Number(stream.progress);
    const progress = Number.isFinite(progressRaw) ? Math.floor(progressRaw) : 0;
    out.videoPostId = String(stream.videoPostId ?? stream.videoId ?? "").trim();
    out.assetId = String(stream.assetId ?? "").trim();
    if (progress >= 100 && !stream.moderated) {
      out.videoUrl = normalizeGrokAssetUrl(stream.videoUrl);
      out.thumbnailUrl = normalizeGrokAssetUrl(stream.thumbnailImageUrl);
    }
  }

  if (!out.assetId && Array.isArray(modelResponse?.fileAttachments)) {
    const asset = modelResponse.fileAttachments.find((item) => typeof item === "string" && item.trim());
    out.assetId = typeof asset === "string" ? asset.trim() : "";
  }
  if (!out.videoUrl && out.assetId) {
    out.videoUrl = resolveAssetContentUrl(out.assetId, cookie);
  }
  if (!out.videoPostId) out.videoPostId = out.assetId;
  return out;
}

export function extractVideoArtifactFromNdjson(text: string, cookie = ""): VideoArtifactInfo {
  const best: VideoArtifactInfo = { videoUrl: "", thumbnailUrl: "", videoPostId: "", assetId: "" };
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const err = asRecord(asRecord(data)?.error);
    if (err?.message) throw new Error(String(err.message));
    const response = asRecord(asRecord(data)?.result)?.response;
    const artifact = extractResponseVideoArtifact(response, cookie);
    if (artifact.videoPostId) best.videoPostId = artifact.videoPostId;
    if (artifact.assetId) best.assetId = artifact.assetId;
    if (artifact.thumbnailUrl) best.thumbnailUrl = artifact.thumbnailUrl;
    if (artifact.videoUrl) best.videoUrl = artifact.videoUrl;
  }
  return best;
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
