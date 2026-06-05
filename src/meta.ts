export const PROJECT_VERSION = "2.0.4.rc4";

const RELEASES_URL = "https://api.github.com/repos/chenyme/grok2api/releases";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  draft?: unknown;
}

interface UpdatePayload {
  current_version: string;
  latest_version: string;
  release_name: string;
  release_url: string;
  published_at: string;
  release_notes: string;
  update_available: boolean;
  checked_at: string;
  status: "ok" | "error";
  error: string;
}

let cachedPayload: UpdatePayload | null = null;
let cacheExpiresAt = 0;

function utcNowIso(): string {
  return new Date().toISOString().replace(".000Z", "Z");
}

export function normalizeVersion(value: string): string {
  const text = String(value || "").trim();
  return text.toLowerCase().startsWith("v") ? text.slice(1) : text;
}

export function parseVersion(value: string): [number, number, number, number, number] | null {
  const match = normalizeVersion(value).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:(?:\.|-)?rc(\d+))?$/i);
  if (!match) return null;
  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  const rc = match[4] === undefined ? null : Number(match[4]);
  return [major, minor, patch, rc === null ? 1 : 0, rc ?? 0];
}

function compareVersionTuple(a: [number, number, number, number, number], b: [number, number, number, number, number]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParsed = parseVersion(latest);
  const currentParsed = parseVersion(current);
  if (latestParsed && currentParsed) return compareVersionTuple(latestParsed, currentParsed) > 0;
  return normalizeVersion(latest) > normalizeVersion(current);
}

function releaseVersionKey(release: GitHubRelease): [number, number, number, number, number] | null {
  return parseVersion(String(release.tag_name || release.name || ""));
}

function selectLatestRelease(releases: GitHubRelease[]): GitHubRelease | null {
  const candidates: Array<{ key: [number, number, number, number, number]; release: GitHubRelease }> = [];
  for (const release of releases) {
    if (!release || typeof release !== "object" || Boolean(release.draft)) continue;
    const key = releaseVersionKey(release);
    if (!key) continue;
    candidates.push({ key, release });
  }
  candidates.sort((a, b) => compareVersionTuple(b.key, a.key));
  return candidates[0]?.release ?? null;
}

function normalizeErrorMessage(value: string): string {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (lower.includes("rate limit exceeded")) return "GitHub API rate limit exceeded.";
  const statusMatch = text.match(/GitHub release query failed:\s*(\d{3})/);
  if (statusMatch) return `GitHub release query failed (${statusMatch[1]}).`;
  if (text.startsWith("GitHub release query failed:")) return "GitHub release query failed.";
  if (text === "GitHub releases response invalid") return "GitHub releases response invalid.";
  if (text === "No valid GitHub releases found") return "No valid GitHub releases found.";
  return text || "Update check failed.";
}

function buildPayload(release: GitHubRelease | null, error = ""): UpdatePayload {
  const latestVersion = normalizeVersion(String(release?.tag_name || release?.name || ""));
  return {
    current_version: PROJECT_VERSION,
    latest_version: latestVersion,
    release_name: String(release?.name || "").trim(),
    release_url: String(release?.html_url || "").trim(),
    published_at: String(release?.published_at || "").trim(),
    release_notes: String(release?.body || "").trim(),
    update_available: Boolean(release && latestVersion && isNewerVersion(latestVersion, PROJECT_VERSION)),
    checked_at: utcNowIso(),
    status: error ? "error" : "ok",
    error: normalizeErrorMessage(error),
  };
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = new URL(RELEASES_URL);
  url.searchParams.set("per_page", "100");
  const resp = await fetch(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "grok2api-update-check",
    },
  });
  if (!resp.ok) {
    const detail = (await resp.text()).trim();
    throw new Error(`GitHub release query failed: ${resp.status} ${detail}`.trim());
  }
  const data = (await resp.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("GitHub releases response invalid");
  const release = selectLatestRelease(data as GitHubRelease[]);
  if (!release) throw new Error("No valid GitHub releases found");
  return release;
}

export async function getLatestReleaseInfo(force = false): Promise<UpdatePayload> {
  const now = Date.now();
  if (!force && cachedPayload && cacheExpiresAt > now) return cachedPayload;

  try {
    const release = await fetchLatestRelease();
    cachedPayload = buildPayload(release);
    cacheExpiresAt = now + CACHE_TTL_MS;
  } catch (e) {
    cachedPayload = buildPayload(null, e instanceof Error ? e.message : String(e));
    cacheExpiresAt = now + ERROR_TTL_MS;
  }
  return cachedPayload;
}
