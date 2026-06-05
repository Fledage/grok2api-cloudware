function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function encodeAssetPath(raw: string): string {
  try {
    const u = new URL(raw);
    return `u_${base64UrlEncode(u.toString())}`;
  } catch {
    const p = raw.startsWith("/") ? raw : `/${raw}`;
    return `p_${base64UrlEncode(p)}`;
  }
}

export function isImaginePublicUrl(raw: string): boolean {
  try {
    const host = new URL(String(raw || "")).hostname.toLowerCase();
    return host.startsWith("imagine-public");
  } catch {
    return false;
  }
}

export function toMediaOutputUrl(args: {
  rawUrl: string;
  baseUrl: string;
  proxyImaginePublic?: boolean;
}): string {
  const rawUrl = String(args.rawUrl || "").trim();
  if (!rawUrl) return "";
  if (isImaginePublicUrl(rawUrl) && args.proxyImaginePublic !== true) return rawUrl;
  return `${args.baseUrl.replace(/\/$/, "")}/images/${encodeAssetPath(rawUrl)}`;
}
