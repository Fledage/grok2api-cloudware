import { getDynamicHeaders } from "./headers";
import type { GrokSettings } from "../settings";

const LIVEKIT_TOKEN_URL = "https://grok.com/rest/livekit/tokens";
const LIVEKIT_WS_BASE = "wss://livekit.grok.com";

export function buildLivekitTokenPayload(args: {
  voice?: string;
  personality?: string;
  speed?: number;
  instruction?: string;
}): Record<string, unknown> {
  const instruction = String(args.instruction ?? "").trim();
  const sessionPayload: Record<string, unknown> = {
    voice: String(args.voice ?? "ara").trim() || "ara",
    personality: instruction ? null : String(args.personality ?? "assistant").trim() || "assistant",
    playback_speed: Number.isFinite(Number(args.speed)) ? Number(args.speed) : 1,
    enable_vision: false,
    turn_detection: { type: "server_vad" },
  };
  if (instruction) {
    sessionPayload.instructions = instruction;
    sessionPayload.is_raw_instructions = true;
  }
  return {
    sessionPayload: JSON.stringify(sessionPayload),
    requestAgentDispatch: false,
    livekitUrl: LIVEKIT_WS_BASE,
    params: { enable_markdown_transcript: "true" },
  };
}

export async function fetchLivekitToken(args: {
  cookie: string;
  settings: GrokSettings;
  voice?: string;
  personality?: string;
  speed?: number;
  instruction?: string;
}): Promise<Record<string, unknown>> {
  const headers = getDynamicHeaders(args.settings, "/rest/livekit/tokens");
  headers.Cookie = args.cookie;
  headers.Origin = "https://grok.com";
  headers.Referer = "https://grok.com/chat";
  headers.Accept = "application/json";

  const payloadArgs: {
    voice?: string;
    personality?: string;
    speed?: number;
    instruction?: string;
  } = {};
  if (args.voice !== undefined) payloadArgs.voice = args.voice;
  if (args.personality !== undefined) payloadArgs.personality = args.personality;
  if (args.speed !== undefined) payloadArgs.speed = args.speed;
  if (args.instruction !== undefined) payloadArgs.instruction = args.instruction;

  const resp = await fetch(LIVEKIT_TOKEN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(buildLivekitTokenPayload(payloadArgs)),
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`LiveKit token upstream ${resp.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("LiveKit token upstream returned invalid JSON");
  }
}
