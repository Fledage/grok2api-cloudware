import type { GrokSettings } from "../settings";
import { buildSsoCookie } from "../settings";
import { getDynamicHeaders } from "./headers";

export const ACCEPT_TOS_URL = "https://accounts.x.ai/auth_mgmt.AuthManagement/SetTosAcceptedVersion";
export const NSFW_MGMT_URL = "https://grok.com/auth_mgmt.AuthManagement/UpdateUserFeatureControls";
export const SET_BIRTH_URL = "https://grok.com/rest/auth/set-birth-date";

const ACCOUNTS_ORIGIN = "https://accounts.x.ai";
const GROK_ORIGIN = "https://grok.com";

const GRPC_HTTP_EQUIV: Record<number, number> = {
  0: 200,
  4: 504,
  7: 403,
  8: 429,
  14: 503,
  16: 401,
};

export interface GrpcStatus {
  code: number;
  message: string;
  httpStatus: number;
}

export interface NsfwSequenceResult {
  success: true;
  tagged: boolean;
  steps: {
    accept_tos?: true;
    birth_date?: true;
    nsfw: true;
  };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function asciiBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function maybeDecodeGrpcWebText(body: Uint8Array, contentType?: string): Uint8Array {
  const ct = String(contentType ?? "").toLowerCase();
  if (!ct.includes("grpc-web-text")) return body;
  let raw = "";
  for (const b of body) raw += String.fromCharCode(b);
  const decoded = atob(raw.replace(/\s+/g, ""));
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

function decodeGrpcMessage(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function parseTrailerPayload(payload: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(payload);
  const trailers: Record<string, string> = {};
  for (const line of text.split(/\r\n|\n/g)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    trailers[key] = key === "grpc-message" ? decodeGrpcMessage(value) : value;
  }
  return trailers;
}

function headersToRecord(headers?: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value);
  return out;
}

export function encodeGrpcWebFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0x00;
  out[1] = (payload.length >>> 24) & 0xff;
  out[2] = (payload.length >>> 16) & 0xff;
  out[3] = (payload.length >>> 8) & 0xff;
  out[4] = payload.length & 0xff;
  out.set(payload, 5);
  return out;
}

export function parseGrpcWebResponse(
  body: Uint8Array,
  contentType?: string,
  headers?: Headers | Record<string, string>,
): { messages: Uint8Array[]; trailers: Record<string, string>; status: GrpcStatus } {
  const decoded = maybeDecodeGrpcWebText(body, contentType);
  const messages: Uint8Array[] = [];
  const trailers: Record<string, string> = {};

  let i = 0;
  while (i + 5 <= decoded.length) {
    const flag = decoded[i] ?? 0;
    const len =
      ((decoded[i + 1] ?? 0) << 24) |
      ((decoded[i + 2] ?? 0) << 16) |
      ((decoded[i + 3] ?? 0) << 8) |
      (decoded[i + 4] ?? 0);
    i += 5;
    if (len < 0 || i + len > decoded.length) break;
    const payload = decoded.slice(i, i + len);
    i += len;
    if (flag & 0x80) Object.assign(trailers, parseTrailerPayload(payload));
    else if (flag & 0x01) throw new Error("grpc-web compressed frame is not supported");
    else messages.push(payload);
  }

  const lowerHeaders = headersToRecord(headers);
  for (const key of ["grpc-status", "grpc-message"]) {
    if (lowerHeaders[key] && !trailers[key]) {
      trailers[key] = key === "grpc-message" ? decodeGrpcMessage(lowerHeaders[key]) : lowerHeaders[key];
    }
  }

  return { messages, trailers, status: parseGrpcStatus(trailers) };
}

export function parseGrpcStatus(trailers: Record<string, string>): GrpcStatus {
  const code = Number.parseInt(String(trailers["grpc-status"] ?? "").trim(), 10);
  const normalized = Number.isFinite(code) ? code : -1;
  return {
    code: normalized,
    message: String(trailers["grpc-message"] ?? ""),
    httpStatus: GRPC_HTTP_EQUIV[normalized] ?? 502,
  };
}

export function buildAcceptTosPayload(): Uint8Array {
  return encodeGrpcWebFrame(new Uint8Array([0x10, 0x01]));
}

export function buildNsfwMgmtPayload(enabled = true): Uint8Array {
  const name = asciiBytes("always_show_nsfw_content");
  const inner = concatBytes([new Uint8Array([0x0a, name.length]), name]);
  const protobuf = concatBytes([
    new Uint8Array([0x0a, 0x02, 0x10, enabled ? 0x01 : 0x00, 0x12, inner.length]),
    inner,
  ]);
  return encodeGrpcWebFrame(protobuf);
}

export function buildSetBirthPayload(now = new Date()): { birthDate: string } {
  const adultYears = 20 + Math.floor(Math.random() * 29);
  const year = now.getUTCFullYear() - adultYears;
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  const hour = Math.floor(Math.random() * 24);
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);
  const millis = Math.floor(Math.random() * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return {
    birthDate: `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millis, 3)}Z`,
  };
}

function grpcHeaders(
  settings: GrokSettings,
  token: string,
  pathname: string,
  origin: string,
  referer: string,
): Record<string, string> {
  const headers = getDynamicHeaders(settings, pathname);
  headers.Cookie = buildSsoCookie(token, settings);
  headers.Origin = origin;
  headers.Referer = referer;
  headers["Content-Type"] = "application/grpc-web+proto";
  headers.Accept = "*/*";
  headers["x-grpc-web"] = "1";
  headers["x-user-agent"] = "connect-es/2.1.1";
  headers["Cache-Control"] = "no-cache";
  headers.Pragma = "no-cache";
  headers["Sec-Fetch-Dest"] = "empty";
  return headers;
}

function jsonHeaders(
  settings: GrokSettings,
  token: string,
  pathname: string,
  origin: string,
  referer: string,
): Record<string, string> {
  const headers = getDynamicHeaders(settings, pathname);
  headers.Cookie = buildSsoCookie(token, settings);
  headers.Origin = origin;
  headers.Referer = referer;
  headers["Content-Type"] = "application/json";
  headers.Accept = "*/*";
  return headers;
}

async function errorText(resp: Response, maxLen: number): Promise<string> {
  return (await resp.text().catch(() => "")).slice(0, maxLen);
}

async function postGrpcWeb(args: {
  url: string;
  token: string;
  settings: GrokSettings;
  payload: Uint8Array;
  label: string;
  origin: string;
  referer: string;
  pathname: string;
}): Promise<GrpcStatus> {
  const body = args.payload.buffer.slice(
    args.payload.byteOffset,
    args.payload.byteOffset + args.payload.byteLength,
  ) as ArrayBuffer;
  const resp = await fetch(args.url, {
    method: "POST",
    headers: grpcHeaders(args.settings, args.token, args.pathname, args.origin, args.referer),
    body,
  });
  if (!resp.ok) {
    throw new Error(`${args.label}: Upstream ${resp.status}: ${await errorText(resp, 300)}`);
  }
  const parsed = parseGrpcWebResponse(new Uint8Array(await resp.arrayBuffer()), resp.headers.get("content-type") ?? "", resp.headers);
  if (parsed.status.code === 0 || parsed.status.code === -1) return parsed.status;
  throw new Error(
    `${args.label}: Upstream ${parsed.status.httpStatus}: gRPC error code=${parsed.status.code} message=${JSON.stringify(
      parsed.status.message,
    )}`,
  );
}

export async function acceptTos(token: string, settings: GrokSettings): Promise<GrpcStatus> {
  return postGrpcWeb({
    url: ACCEPT_TOS_URL,
    token,
    settings,
    payload: buildAcceptTosPayload(),
    label: "accept_tos",
    origin: ACCOUNTS_ORIGIN,
    referer: `${ACCOUNTS_ORIGIN}/accept-tos`,
    pathname: "/auth_mgmt.AuthManagement/SetTosAcceptedVersion",
  });
}

export async function setBirthDate(token: string, settings: GrokSettings): Promise<Record<string, unknown>> {
  const resp = await fetch(SET_BIRTH_URL, {
    method: "POST",
    headers: jsonHeaders(settings, token, "/rest/auth/set-birth-date", GROK_ORIGIN, `${GROK_ORIGIN}/?_s=data`),
    body: JSON.stringify(buildSetBirthPayload()),
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`set_birth_date: Upstream ${resp.status}: ${text.slice(0, 300)}`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("set_birth_date: upstream returned invalid JSON");
  }
}

export async function setNsfw(token: string, settings: GrokSettings, enabled = true): Promise<GrpcStatus> {
  return postGrpcWeb({
    url: NSFW_MGMT_URL,
    token,
    settings,
    payload: buildNsfwMgmtPayload(enabled),
    label: enabled ? "enable_nsfw" : "disable_nsfw",
    origin: GROK_ORIGIN,
    referer: `${GROK_ORIGIN}/?_s=data`,
    pathname: "/auth_mgmt.AuthManagement/UpdateUserFeatureControls",
  });
}

export async function runNsfwSequence(args: {
  token: string;
  settings: GrokSettings;
  enabled?: boolean;
}): Promise<NsfwSequenceResult> {
  const enabled = args.enabled !== false;
  if (!enabled) {
    await setNsfw(args.token, args.settings, false);
    return { success: true, tagged: false, steps: { nsfw: true } };
  }
  await acceptTos(args.token, args.settings);
  await setBirthDate(args.token, args.settings);
  await setNsfw(args.token, args.settings, true);
  return { success: true, tagged: true, steps: { accept_tos: true, birth_date: true, nsfw: true } };
}
