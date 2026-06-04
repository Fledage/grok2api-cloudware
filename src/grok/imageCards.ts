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
