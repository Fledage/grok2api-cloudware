export type ModelTier = "basic" | "super" | "heavy";
export type ModelCapability = "chat" | "image" | "image_edit" | "video";

export interface ModelInfo {
  mode_id: string;
  tier: ModelTier;
  capabilities: ModelCapability[];
  display_name: string;
  description: string;
  raw_model_path: string;
  default_temperature: number;
  default_max_output_tokens: number;
  supported_max_output_tokens: number;
  default_top_p: number;
  prefer_best?: boolean;
  legacy_alias?: boolean;
  is_image_model?: boolean;
  is_video_model?: boolean;
}

const CHAT_DEFAULTS = {
  default_temperature: 1.0,
  default_max_output_tokens: 8192,
  supported_max_output_tokens: 131072,
  default_top_p: 0.95,
};

function chat(
  mode_id: string,
  tier: ModelTier,
  display_name: string,
  opts: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    mode_id,
    tier,
    capabilities: ["chat"],
    display_name,
    description: `${display_name} chat model`,
    raw_model_path: `xai/${mode_id}`,
    ...CHAT_DEFAULTS,
    ...opts,
  };
}

function image(
  mode_id: string,
  tier: ModelTier,
  display_name: string,
  capability: "image" | "image_edit" | "video",
  opts: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    mode_id,
    tier,
    capabilities: [capability],
    display_name,
    description: `${display_name} model`,
    raw_model_path: `xai/${mode_id}`,
    ...CHAT_DEFAULTS,
    ...opts,
    is_image_model: capability === "image" || capability === "image_edit",
    is_video_model: capability === "video",
  };
}

export const MODEL_CONFIG: Record<string, ModelInfo> = {
  // chenyme/grok2api main (5805cbb) model catalog.
  "grok-4.20-0309-non-reasoning": chat("fast", "basic", "Grok 4.20 0309 Non-Reasoning", {
    raw_model_path: "xai/grok-4.20-0309-non-reasoning",
  }),
  "grok-4.20-0309": chat("auto", "super", "Grok 4.20 0309", {
    raw_model_path: "xai/grok-4.20-0309",
  }),
  "grok-4.20-0309-reasoning": chat("expert", "super", "Grok 4.20 0309 Reasoning", {
    raw_model_path: "xai/grok-4.20-0309-reasoning",
    default_max_output_tokens: 32768,
  }),
  "grok-4.20-0309-non-reasoning-super": chat("fast", "super", "Grok 4.20 0309 Non-Reasoning Super", {
    raw_model_path: "xai/grok-4.20-0309-non-reasoning-super",
  }),
  "grok-4.20-0309-super": chat("auto", "super", "Grok 4.20 0309 Super", {
    raw_model_path: "xai/grok-4.20-0309-super",
  }),
  "grok-4.20-0309-reasoning-super": chat("expert", "super", "Grok 4.20 0309 Reasoning Super", {
    raw_model_path: "xai/grok-4.20-0309-reasoning-super",
    default_max_output_tokens: 32768,
  }),
  "grok-4.20-0309-non-reasoning-heavy": chat("fast", "heavy", "Grok 4.20 0309 Non-Reasoning Heavy", {
    raw_model_path: "xai/grok-4.20-0309-non-reasoning-heavy",
  }),
  "grok-4.20-0309-heavy": chat("auto", "heavy", "Grok 4.20 0309 Heavy", {
    raw_model_path: "xai/grok-4.20-0309-heavy",
    default_max_output_tokens: 65536,
  }),
  "grok-4.20-0309-reasoning-heavy": chat("expert", "heavy", "Grok 4.20 0309 Reasoning Heavy", {
    raw_model_path: "xai/grok-4.20-0309-reasoning-heavy",
    default_max_output_tokens: 65536,
  }),
  "grok-4.20-multi-agent-0309": chat("heavy", "heavy", "Grok 4.20 Multi-Agent 0309", {
    raw_model_path: "xai/grok-4.20-multi-agent-0309",
    default_max_output_tokens: 65536,
  }),
  "grok-4.20-fast": chat("fast", "basic", "Grok 4.20 Fast", {
    raw_model_path: "xai/grok-4.20-fast",
    prefer_best: true,
  }),
  "grok-4.20-auto": chat("auto", "super", "Grok 4.20 Auto", {
    raw_model_path: "xai/grok-4.20-auto",
    prefer_best: true,
  }),
  "grok-4.20-expert": chat("expert", "super", "Grok 4.20 Expert", {
    raw_model_path: "xai/grok-4.20-expert",
    prefer_best: true,
    default_max_output_tokens: 32768,
  }),
  "grok-4.20-heavy": chat("heavy", "heavy", "Grok 4.20 Heavy", {
    raw_model_path: "xai/grok-4.20-heavy",
    prefer_best: true,
    default_max_output_tokens: 65536,
  }),
  "grok-4.3-beta": chat("grok-420-computer-use-sa", "super", "Grok 4.3 Beta", {
    raw_model_path: "xai/grok-4.3-beta",
  }),

  "grok-imagine-image-lite": image("fast", "basic", "Grok Imagine Image Lite", "image", {
    raw_model_path: "xai/grok-imagine-image-lite",
  }),
  "grok-imagine-image": image("auto", "super", "Grok Imagine Image", "image", {
    raw_model_path: "xai/grok-imagine-image",
  }),
  "grok-imagine-image-pro": image("auto", "super", "Grok Imagine Image Pro", "image", {
    raw_model_path: "xai/grok-imagine-image-pro",
  }),
  "grok-imagine-image-edit": image("auto", "super", "Grok Imagine Image Edit", "image_edit", {
    raw_model_path: "xai/grok-imagine-image-edit",
  }),
  "grok-imagine-video": image("auto", "super", "Grok Imagine Video", "video", {
    raw_model_path: "xai/grok-imagine-video",
  }),

  // Compatibility aliases from the older Workers fork.
  "grok-4": chat("auto", "super", "Grok 4", {
    raw_model_path: "xai/grok-4",
    legacy_alias: true,
  }),
  "grok-4-mini": chat("fast", "basic", "Grok 4 Mini", {
    raw_model_path: "xai/grok-4-mini",
    legacy_alias: true,
  }),
  "grok-4-thinking": chat("expert", "super", "Grok 4 Thinking", {
    raw_model_path: "xai/grok-4",
    legacy_alias: true,
    default_max_output_tokens: 32768,
  }),
  "grok-4-heavy": chat("heavy", "heavy", "Grok 4 Heavy", {
    raw_model_path: "xai/grok-4",
    legacy_alias: true,
    default_max_output_tokens: 65536,
  }),
  "grok-4.1-mini": chat("fast", "basic", "Grok 4.1 Mini", {
    raw_model_path: "xai/grok-4-1-thinking-1129",
    legacy_alias: true,
  }),
  "grok-4.1-fast": chat("fast", "basic", "Grok 4.1 Fast", {
    raw_model_path: "xai/grok-4-1-thinking-1129",
    legacy_alias: true,
  }),
  "grok-4.1-expert": chat("expert", "super", "Grok 4.1 Expert", {
    raw_model_path: "xai/grok-4-1-thinking-1129",
    legacy_alias: true,
    default_max_output_tokens: 32768,
  }),
  "grok-4.1-thinking": chat("expert", "super", "Grok 4.1 Thinking", {
    raw_model_path: "xai/grok-4-1-thinking-1129",
    legacy_alias: true,
    default_max_output_tokens: 32768,
  }),
  "grok-4.20-beta": chat("auto", "super", "Grok 4.20 Beta", {
    raw_model_path: "xai/grok-420",
    legacy_alias: true,
  }),
  "grok-imagine-1.0": image("fast", "basic", "Grok Imagine 1.0", "image", {
    raw_model_path: "xai/grok-imagine-1.0",
    legacy_alias: true,
  }),
  "grok-imagine-1.0-edit": image("auto", "super", "Grok Imagine 1.0 Edit", "image_edit", {
    raw_model_path: "xai/grok-imagine-1.0-edit",
    legacy_alias: true,
  }),
  "grok-imagine-1.0-video": image("auto", "super", "Grok Imagine 1.0 Video", "video", {
    raw_model_path: "xai/grok-imagine-1.0-video",
    legacy_alias: true,
  }),
};

export function isValidModel(model: string): boolean {
  return Boolean(MODEL_CONFIG[model]);
}

export function getModelInfo(model: string): ModelInfo | null {
  return MODEL_CONFIG[model] ?? null;
}

export function toGrokModel(model: string): { modeId: string; isVideoModel: boolean } {
  const cfg = MODEL_CONFIG[model];
  if (!cfg) return { modeId: "fast", isVideoModel: false };
  return { modeId: cfg.mode_id, isVideoModel: Boolean(cfg.is_video_model) };
}

export function toRateLimitModel(model: string): string {
  return MODEL_CONFIG[model]?.mode_id ?? model;
}

export function tokenPoolOrder(model: string): Array<"sso" | "ssoSuper"> {
  const cfg = MODEL_CONFIG[model];
  if (!cfg) return ["sso", "ssoSuper"];
  if (cfg.tier === "heavy") return ["ssoSuper"];
  if (cfg.prefer_best) {
    return cfg.tier === "basic" ? ["ssoSuper", "sso"] : ["ssoSuper"];
  }
  return cfg.tier === "basic" ? ["sso", "ssoSuper"] : ["ssoSuper"];
}

export function quotaFieldForModel(model: string): "remaining_queries" | "heavy_remaining_queries" {
  const cfg = MODEL_CONFIG[model];
  return cfg?.tier === "heavy" || cfg?.mode_id === "heavy" ? "heavy_remaining_queries" : "remaining_queries";
}
