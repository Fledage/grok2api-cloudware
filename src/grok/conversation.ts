import type { GrokSettings } from "../settings";
import { getDynamicHeaders } from "./headers";
import { getModelInfo, toGrokModel } from "./models";
import { toolCallsToXml } from "./tooling";

export interface OpenAIChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url?: string } }>;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
}

export interface OpenAIChatRequestBody {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  video_config?: {
    aspect_ratio?: string;
    video_length?: number;
    seconds?: number;
    resolution?: string;
    resolution_name?: string;
    preset?: string;
  };
}

export const CONVERSATION_API = "https://grok.com/rest/app-chat/conversations/new";

export function extractContent(messages: OpenAIChatMessage[]): { content: string; images: string[] } {
  const images: string[] = [];
  const extracted: Array<{ role: string; text: string }> = [];

  for (const msg of messages) {
    const role = msg.role ?? "user";
    if (role === "tool") {
      const toolResult = String(msg.content ?? "").trim();
      const toolCallId = String(msg.tool_call_id ?? "").trim();
      if (toolResult) {
        const label = toolCallId ? `[tool result for ${toolCallId}]` : "[tool result]";
        extracted.push({ role, text: `${label}:\n${toolResult}` });
      }
      continue;
    }
    if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const xml = toolCallsToXml(msg.tool_calls);
      const text = typeof msg.content === "string" ? String(msg.content).trim() : "";
      extracted.push({ role, text: text ? `${text}\n${xml}` : xml });
      continue;
    }
    const content = msg.content ?? "";

    const parts: string[] = [];
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === "text") {
          const t = item.text ?? "";
          if (t.trim()) parts.push(t);
        }
        if (item?.type === "image_url") {
          const url = item.image_url?.url;
          if (url) images.push(url);
        }
      }
    } else {
      const t = String(content);
      if (t.trim()) parts.push(t);
    }

    if (parts.length) extracted.push({ role, text: parts.join("\n") });
  }

  let lastUserIndex: number | null = null;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i]!.role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const out: string[] = [];
  for (let i = 0; i < extracted.length; i++) {
    const role = extracted[i]!.role || "user";
    const text = extracted[i]!.text;
    if (i === lastUserIndex) out.push(text);
    else out.push(`${role}: ${text}`);
  }

  return { content: out.join("\n\n"), images };
}

export function buildConversationPayload(args: {
  requestModel: string;
  content: string;
  imgIds: string[];
  imgUris: string[];
  postId?: string;
  videoImageReferences?: string[];
  videoConfig?: {
    aspect_ratio?: string;
    video_length?: number;
    seconds?: number;
    resolution?: string;
    resolution_name?: string;
    preset?: string;
  };
  settings: GrokSettings;
}): { payload: Record<string, unknown>; referer?: string; isVideoModel: boolean } {
  const { requestModel, content, imgIds, imgUris, postId, settings } = args;
  const cfg = getModelInfo(requestModel);
  const { modeId, isVideoModel } = toGrokModel(requestModel);

  if (cfg?.is_video_model) {
    if (!postId) throw new Error("视频模型缺少 postId（需要先创建 media post）");

    const aspectRatio = (args.videoConfig?.aspect_ratio ?? "").trim() || "3:2";
    const videoLengthRaw = Number(args.videoConfig?.seconds ?? args.videoConfig?.video_length ?? 6);
    const rawVideoLength = Number.isFinite(videoLengthRaw) ? Math.max(1, Math.floor(videoLengthRaw)) : 6;
    const videoLength = [6, 10, 12, 16, 20].includes(rawVideoLength) ? rawVideoLength : 6;
    const resolutionName = normalizeVideoResolutionName(
      args.videoConfig?.resolution_name ?? args.videoConfig?.resolution,
    );
    const preset = normalizeVideoPreset(args.videoConfig?.preset);

    const prompt = `${String(content || "").trim()} ${videoPresetFlag(preset)}`.trim();

    const videoGenModelConfig: Record<string, unknown> = {
      parentPostId: postId,
      aspectRatio,
      videoLength,
      resolutionName,
    };
    const imageReferences = (args.videoImageReferences ?? []).map((v) => String(v || "").trim()).filter(Boolean);
    if (imageReferences.length) {
      videoGenModelConfig.isVideoEdit = false;
      videoGenModelConfig.isReferenceToVideo = true;
      videoGenModelConfig.imageReferences = imageReferences;
    }

    return {
      isVideoModel: true,
      referer: "https://grok.com/imagine",
      payload: {
        temporary: true,
        modelName: "imagine-video-gen",
        message: prompt,
        enableSideBySide: true,
        responseMetadata: {
          experiments: [],
          modelConfigOverride: {
            modelMap: {
              videoGenModelConfig,
            },
          },
        },
      },
    };
  }

  return {
    isVideoModel,
    payload: {
      collectionIds: [],
      connectors: [],
      deviceEnvInfo: {
        darkModeEnabled: false,
        devicePixelRatio: 2,
        screenHeight: 1329,
        screenWidth: 2056,
        viewportHeight: 1083,
        viewportWidth: 2056,
      },
      temporary: settings.temporary ?? true,
      message: content,
      modeId,
      fileAttachments: imgIds,
      imageAttachments: [],
      searchAllConnectors: false,
      disableSelfHarmShortCircuit: false,
      disableSearch: false,
      enableImageGeneration: true,
      returnImageBytes: false,
      returnRawGrokInXaiRequest: false,
      enableImageStreaming: true,
      imageGenerationCount: 2,
      forceConcise: false,
      toolOverrides: {
        gmailSearch: false,
        googleCalendarSearch: false,
        outlookSearch: false,
        outlookCalendarSearch: false,
        googleDriveSearch: false,
      },
      enableSideBySide: true,
      sendFinalMetadata: true,
      webpageUrls: [],
      disableTextFollowUps: false,
      responseMetadata: {},
      disableMemory: false,
      forceSideBySide: false,
      isAsyncChat: false,
    },
  };
}

function normalizeVideoResolutionName(input: unknown): "480p" | "720p" {
  const value = String(input ?? "")
    .trim()
    .toLowerCase();
  if (value === "480p" || value === "sd") return "480p";
  if (value === "720p" || value === "hd") return "720p";
  return "720p";
}

function normalizeVideoPreset(input: unknown): "fun" | "normal" | "spicy" | "custom" {
  const value = String(input ?? "custom")
    .trim()
    .toLowerCase();
  if (value === "fun" || value === "normal" || value === "spicy" || value === "custom") return value;
  return "custom";
}

function videoPresetFlag(preset: "fun" | "normal" | "spicy" | "custom"): string {
  if (preset === "fun") return "--mode=extremely-crazy";
  if (preset === "normal") return "--mode=normal";
  if (preset === "spicy") return "--mode=extremely-spicy-or-crazy";
  return "--mode=custom";
}

export async function sendConversationRequest(args: {
  payload: Record<string, unknown>;
  cookie: string;
  settings: GrokSettings;
  referer?: string;
}): Promise<Response> {
  const { payload, cookie, settings, referer } = args;
  const headers = getDynamicHeaders(settings, "/rest/app-chat/conversations/new");
  headers.Cookie = cookie;
  if (referer) headers.Referer = referer;
  const body = JSON.stringify(payload);

  return fetch(CONVERSATION_API, { method: "POST", headers, body });
}
