import type { GrokSettings } from "../settings";
import { getDynamicHeaders } from "./headers";

const ASSETS_LIST_URL = "https://grok.com/rest/assets";
const ASSET_DELETE_BASE = "https://grok.com/rest/assets-metadata";

export interface NormalizedAssetItem {
  id: string;
  name: string;
  file_path: string;
  content_type: string;
  size: number;
  created_at: string;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function toSafeNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function assetHeaders(settings: GrokSettings, cookie: string, pathname: string): Record<string, string> {
  const headers = getDynamicHeaders(settings, pathname);
  headers.Cookie = cookie;
  headers.Origin = "https://grok.com";
  headers.Referer = "https://grok.com/files";
  headers.Accept = "application/json, text/plain, */*";
  delete headers["Content-Type"];
  return headers;
}

export function normalizeAssetItems(input: unknown): NormalizedAssetItem[] {
  if (!Array.isArray(input)) return [];
  const out: NormalizedAssetItem[] = [];
  for (const item of input) {
    const row = asRecord(item);
    if (!row) continue;
    const id = firstString(row.id, row.assetId, row.asset_id);
    if (!id) continue;
    out.push({
      id,
      name: firstString(row.fileName, row.name),
      file_path: firstString(row.filePath, row.file_path),
      content_type: firstString(row.contentType, row.content_type),
      size: toSafeNumber(row.fileSize ?? row.size),
      created_at: firstString(row.createdAt, row.created_at),
    });
  }
  return out;
}

export async function listAssets(args: {
  cookie: string;
  settings: GrokSettings;
  signal?: AbortSignal;
}): Promise<NormalizedAssetItem[]> {
  const init: RequestInit = {
    method: "GET",
    headers: assetHeaders(args.settings, args.cookie, "/rest/assets"),
  };
  if (args.signal) init.signal = args.signal;
  const resp = await fetch(ASSETS_LIST_URL, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upstream ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return normalizeAssetItems(data.assets ?? data.items);
}

export async function deleteAsset(args: {
  assetId: string;
  cookie: string;
  settings: GrokSettings;
  signal?: AbortSignal;
}): Promise<void> {
  const assetId = String(args.assetId || "").trim();
  if (!assetId) throw new Error("Missing asset id");
  const pathname = `/rest/assets-metadata/${encodeURIComponent(assetId)}`;
  const init: RequestInit = {
    method: "DELETE",
    headers: assetHeaders(args.settings, args.cookie, pathname),
  };
  if (args.signal) init.signal = args.signal;
  const resp = await fetch(`${ASSET_DELETE_BASE}/${encodeURIComponent(assetId)}`, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upstream ${resp.status}: ${text.slice(0, 300)}`);
  }
}
