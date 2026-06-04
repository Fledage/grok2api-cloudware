const GROK_ASSET_ORIGIN = "https://assets.grok.com";

export type ImageChunkInfo = {
  progress?: number;
  imageUuid: string;
  url?: string;
  moderated: boolean;
};

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : null;
}

export function normalizeGrokAssetUrl(input: unknown): string {
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

export function extractImageChunkFromCardAttachment(cardAttachment: unknown): ImageChunkInfo | null {
  const card = asRecord(cardAttachment);
  if (!card) return null;

  const jsonData = card.jsonData;
  let parsed: unknown;
  if (typeof jsonData === "string") {
    try {
      parsed = JSON.parse(jsonData);
    } catch {
      return null;
    }
  } else {
    parsed = jsonData;
  }

  const data = asRecord(parsed);
  const chunk = asRecord(data?.image_chunk);
  if (!chunk) return null;

  const progressRaw = Number(chunk.progress);
  const progress = Number.isFinite(progressRaw) ? Math.floor(progressRaw) : undefined;
  const imageUuid = typeof chunk.imageUuid === "string" ? chunk.imageUuid : "";
  const moderated = Boolean(chunk.moderated);
  const url = moderated || progress !== 100 ? "" : normalizeGrokAssetUrl(chunk.imageUrl);

  return {
    ...(progress === undefined ? {} : { progress }),
    imageUuid,
    ...(url ? { url } : {}),
    moderated,
  };
}

function extractCookieValue(cookie: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function resolveAssetContentUrl(assetId: unknown, cookie = ""): string {
  if (typeof assetId !== "string") return "";
  const id = assetId.trim();
  if (!id) return "";
  const userId = extractCookieValue(cookie, "x-userid");
  if (!userId) return "";
  return `${GROK_ASSET_ORIGIN}/users/${encodeURIComponent(userId)}/${encodeURIComponent(id)}/content`;
}

export function extractModelResponseImageUrls(modelResponse: unknown, cookie = ""): string[] {
  const model = asRecord(modelResponse);
  if (!model) return [];

  const out: string[] = [];
  const urls = model.generatedImageUrls;
  if (Array.isArray(urls)) {
    for (const url of urls) {
      const normalized = normalizeGrokAssetUrl(url);
      if (normalized) out.push(normalized);
    }
  }

  const attachments = model.fileAttachments;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      const resolved = resolveAssetContentUrl(attachment, cookie);
      if (resolved) out.push(resolved);
    }
  }

  return out;
}

export function extractStreamingImageUrls(streamingResponse: unknown, cookie = ""): string[] {
  const stream = asRecord(streamingResponse);
  if (!stream) return [];

  const progressRaw = Number(stream.progress);
  const progress = Number.isFinite(progressRaw) ? Math.floor(progressRaw) : 0;
  if (progress < 100 || Boolean(stream.moderated)) return [];

  const rawUrl = normalizeGrokAssetUrl(stream.imageUrl);
  if (rawUrl) return [rawUrl];

  const assetUrl = resolveAssetContentUrl(stream.assetId, cookie);
  return assetUrl ? [assetUrl] : [];
}

export function extractResponseImageUrls(response: unknown, cookie = ""): string[] {
  const resp = asRecord(response);
  if (!resp) return [];

  const out: string[] = [];
  const cardImage = extractImageChunkFromCardAttachment(resp.cardAttachment);
  if (cardImage?.url) out.push(cardImage.url);
  out.push(...extractStreamingImageUrls(resp.streamingImageGenerationResponse, cookie));
  out.push(...extractModelResponseImageUrls(resp.modelResponse, cookie));

  const seen = new Set<string>();
  return out.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
