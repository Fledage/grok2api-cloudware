import type { GrokSettings } from "../settings";
import { getDynamicHeaders } from "./headers";
import { toRateLimitModel } from "./models";

const RATE_LIMIT_API = "https://grok.com/rest/rate-limits";

export async function checkRateLimits(
  cookie: string,
  settings: GrokSettings,
  model: string,
): Promise<Record<string, unknown> | null> {
  const rateModel = toRateLimitModel(model);
  const headers = getDynamicHeaders(settings, "/rest/rate-limits");
  headers.Cookie = cookie;
  const body = JSON.stringify({ requestKind: "DEFAULT", modelName: rateModel });

  const resp = await fetch(RATE_LIMIT_API, { method: "POST", headers, body });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Record<string, unknown>;
  const remaining = data.remainingQueries;
  const total = data.totalQueries;
  return {
    ...data,
    remainingTokens: typeof remaining === "number" ? remaining : data.remainingTokens,
    limit: typeof total === "number" ? total : data.limit,
  };
}

