import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-protocol-"));

function walkJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) out.push(...walkJsFiles(file));
    else if (file.endsWith(".js")) out.push(file);
  }
  return out;
}

function patchRelativeImports(dir) {
  for (const file of walkJsFiles(dir)) {
    const source = readFileSync(file, "utf8");
    const patched = source.replace(
      /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
      (_m, prefix, spec, suffix) => {
        if (/\.(?:js|json|wasm)$/.test(spec)) return `${prefix}${spec}${suffix}`;
        return `${prefix}${spec}.js${suffix}`;
      },
    );
    if (patched !== source) writeFileSync(file, patched);
  }
}

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "-p",
      "tsconfig.json",
      "--outDir",
      outDir,
      "--rootDir",
      ".",
      "--noEmit",
      "false",
      "--declaration",
      "false",
      "--sourceMap",
      "false",
      "--pretty",
      "false",
    ],
    { cwd: root, stdio: "pipe", shell: process.platform === "win32" },
  );
  patchRelativeImports(outDir);

  const conversation = await import(pathToFileURL(join(outDir, "src/grok/conversation.js")));
  const assets = await import(pathToFileURL(join(outDir, "src/grok/assets.js")));
  const imageCards = await import(pathToFileURL(join(outDir, "src/grok/imageCards.js")));
  const imagine = await import(pathToFileURL(join(outDir, "src/grok/imagineExperimental.js")));
  const mediaUrls = await import(pathToFileURL(join(outDir, "src/grok/mediaUrls.js")));
  const models = await import(pathToFileURL(join(outDir, "src/grok/models.js")));
  const nsfw = await import(pathToFileURL(join(outDir, "src/grok/nsfw.js")));
  const videoApi = await import(pathToFileURL(join(outDir, "src/grok/video.js")));

  assert.equal(
    models.isModelAvailableForPools("grok-imagine-image-lite", { basic: false, super: false, heavy: false }),
    false,
  );
  assert.equal(
    models.isModelAvailableForPools("grok-imagine-image-lite", { basic: true, super: false, heavy: false }),
    true,
  );
  assert.equal(
    models.isModelAvailableForPools("grok-imagine-image", { basic: true, super: false, heavy: false }),
    false,
  );
  assert.equal(
    models.isModelAvailableForPools("grok-imagine-image", { basic: false, super: true, heavy: false }),
    true,
  );
  const publicImageUrl = "https://imagine-public.grok.com/generated/image.png";
  assert.equal(mediaUrls.isImaginePublicUrl(publicImageUrl), true);
  assert.equal(
    mediaUrls.toMediaOutputUrl({
      rawUrl: publicImageUrl,
      baseUrl: "https://worker.example",
      proxyImaginePublic: false,
    }),
    publicImageUrl,
  );
  assert.equal(
    mediaUrls.toMediaOutputUrl({
      rawUrl: publicImageUrl,
      baseUrl: "https://worker.example",
      proxyImaginePublic: true,
    }).startsWith("https://worker.example/images/u_"),
    true,
  );
  assert.equal(
    mediaUrls.toMediaOutputUrl({
      rawUrl: "https://assets.grok.com/users/demo/generated/image.png",
      baseUrl: "https://worker.example",
      proxyImaginePublic: false,
    }).startsWith("https://worker.example/images/u_"),
    true,
  );
  assert.deepEqual(
    assets.normalizeAssetItems([
      {
        id: "asset_1",
        fileName: "cat.png",
        filePath: "/users/u/asset_1/content",
        contentType: "image/png",
        fileSize: 1234,
        createdAt: "2026-06-05T01:00:00Z",
      },
      {
        assetId: "asset_2",
        name: "video.mp4",
        file_path: "/users/u/asset_2/content",
        content_type: "video/mp4",
        size: "42",
        created_at: "2026-06-05T02:00:00Z",
      },
    ]),
    [
      {
        id: "asset_1",
        name: "cat.png",
        file_path: "/users/u/asset_1/content",
        content_type: "image/png",
        size: 1234,
        created_at: "2026-06-05T01:00:00Z",
      },
      {
        id: "asset_2",
        name: "video.mp4",
        file_path: "/users/u/asset_2/content",
        content_type: "video/mp4",
        size: 42,
        created_at: "2026-06-05T02:00:00Z",
      },
    ],
  );
  assert.equal(
    models.isModelAvailableForPools("grok-4.20-heavy", { basic: false, super: true, heavy: false }),
    false,
  );
  assert.equal(
    models.isModelAvailableForPools("grok-4.20-heavy", { basic: false, super: false, heavy: true }),
    true,
  );
  assert.equal(
    models.isModelAvailableForPools("grok-4.20-auto", { basic: false, super: false, heavy: true }),
    true,
  );

  assert.deepEqual([...nsfw.buildAcceptTosPayload()], [0, 0, 0, 0, 2, 16, 1]);
  assert.deepEqual(
    [...nsfw.encodeGrpcWebFrame(new Uint8Array([1, 2, 3]))],
    [0, 0, 0, 0, 3, 1, 2, 3],
  );
  const enabledPayload = [...nsfw.buildNsfwMgmtPayload(true)];
  const disabledPayload = [...nsfw.buildNsfwMgmtPayload(false)];
  assert.equal(enabledPayload[0], 0);
  assert.equal(enabledPayload[4], 32);
  assert.equal(enabledPayload[8], 1);
  assert.equal(disabledPayload[8], 0);
  assert.equal(enabledPayload[9], 18);
  assert.equal(enabledPayload[10], 26);
  assert.equal(enabledPayload[11], 10);
  assert.equal(enabledPayload[12], 24);
  assert.equal(new TextDecoder().decode(nsfw.buildNsfwMgmtPayload(true).slice(13)), "always_show_nsfw_content");
  const trailerOnly = new Uint8Array([
    128, 0, 0, 0, 15, 103, 114, 112, 99, 45, 115, 116, 97, 116, 117, 115, 58, 48, 13, 10,
  ]);
  assert.equal(nsfw.parseGrpcWebResponse(trailerOnly).status.code, 0);
  assert.equal(nsfw.parseGrpcWebResponse(new Uint8Array([])).status.code, -1);
  const headerStatus = nsfw.parseGrpcWebResponse(new Uint8Array([]), "", {
    "grpc-status": "7",
    "grpc-message": "permission%20denied",
  }).status;
  assert.equal(headerStatus.code, 7);
  assert.equal(headerStatus.httpStatus, 403);
  assert.equal(headerStatus.message, "permission denied");
  assert.match(nsfw.buildSetBirthPayload(new Date("2026-06-05T00:00:00Z")).birthDate, /^\d{4}-\d{2}-\d{2}T/);

  const video = conversation.buildConversationPayload({
    requestModel: "grok-imagine-video",
    content: "city skyline",
    imgIds: [],
    imgUris: [],
    postId: "post_123",
    videoConfig: {
      aspect_ratio: "16:9",
      video_length: 6,
      resolution: "HD",
      preset: "normal",
    },
    settings: { temporary: true },
  });

  const videoConfig =
    video.payload.responseMetadata?.modelConfigOverride?.modelMap?.videoGenModelConfig;
  assert.equal(video.payload.modelName, "imagine-video-gen");
  assert.equal(video.payload.toolOverrides, undefined);
  assert.equal(video.payload.message, "city skyline --mode=normal");
  assert.equal(videoConfig.parentPostId, "post_123");
  assert.equal(videoConfig.aspectRatio, "16:9");
  assert.equal(videoConfig.videoLength, 6);
  assert.equal(videoConfig.resolutionName, "720p");
  assert.equal(videoConfig.videoResolution, undefined);

  const videoWithReference = conversation.buildConversationPayload({
    requestModel: "grok-imagine-video",
    content: "animate this",
    imgIds: [],
    imgUris: [],
    postId: "post_ref",
    videoImageReferences: ["https://assets.grok.com/users/demo/image/content"],
    videoConfig: { video_length: 6 },
    settings: { temporary: true },
  });
  const refVideoConfig =
    videoWithReference.payload.responseMetadata?.modelConfigOverride?.modelMap?.videoGenModelConfig;
  assert.equal(refVideoConfig.isVideoEdit, false);
  assert.equal(refVideoConfig.isReferenceToVideo, true);
  assert.deepEqual(refVideoConfig.imageReferences, ["https://assets.grok.com/users/demo/image/content"]);

  assert.deepEqual(videoApi.resolveVideoSize("1280x720"), { aspectRatio: "16:9", resolutionName: "720p" });
  assert.deepEqual(videoApi.resolveVideoSize("1024x1024"), { aspectRatio: "1:1", resolutionName: "720p" });
  assert.equal(videoApi.resolveVideoSeconds("20"), 20);
  assert.deepEqual(videoApi.buildVideoSegmentLengths(6), [6]);
  assert.deepEqual(videoApi.buildVideoSegmentLengths(10), [10]);
  assert.deepEqual(videoApi.buildVideoSegmentLengths(12), [6, 6]);
  assert.deepEqual(videoApi.buildVideoSegmentLengths(16), [10, 6]);
  assert.deepEqual(videoApi.buildVideoSegmentLengths(20), [10, 10]);
  assert.equal(videoApi.videoExtendStartTime(10), 10.041667);
  const extendPayload = videoApi.buildVideoExtendPayload({
    prompt: "extend city",
    parentPostId: "parent_post",
    extendPostId: "segment_post",
    aspectRatio: "16:9",
    resolutionName: "720p",
    videoLength: 6,
    preset: "normal",
    startTimeSeconds: videoApi.videoExtendStartTime(10),
  });
  const extendConfig =
    extendPayload.responseMetadata?.modelConfigOverride?.modelMap?.videoGenModelConfig;
  assert.equal(extendPayload.modelName, "imagine-video-gen");
  assert.equal(extendPayload.message, "extend city --mode=normal");
  assert.equal(extendConfig.isVideoExtension, true);
  assert.equal(extendConfig.extendPostId, "segment_post");
  assert.equal(extendConfig.parentPostId, "parent_post");
  assert.equal(extendConfig.videoLength, 6);
  assert.equal(extendConfig.videoExtensionStartTime, 10.041667);
  assert.throws(() => videoApi.resolveVideoSeconds(8), /seconds must be one of/);
  assert.equal(
    videoApi.extractVideoArtifactFromNdjson(
      [
        JSON.stringify({
          result: {
            response: {
              streamingVideoGenerationResponse: {
                progress: 100,
                videoUrl: "/users/demo/videos/final.mp4",
                videoPostId: "post_final",
              },
            },
          },
        }),
      ].join("\n"),
      "",
    ).videoPostId,
    "post_final",
  );
  assert.equal(videoApi.normalizeVideoPreset("spicy"), "spicy");
  assert.equal(videoApi.normalizeVideoPreset("unknown"), "custom");

  assert.equal(
    videoApi.extractVideoUrlFromChatCompletion({
      choices: [
        {
          message: {
            content:
              '<video src="https://grok2api.example/images/u_abc" controls="controls"></video>',
          },
        },
      ],
    }),
    "https://grok2api.example/images/u_abc",
  );
  assert.equal(
    videoApi.extractVideoUrlFromChatCompletion({
      choices: [{ message: { content: '<a href="https://grok2api.example/images/u_def">video</a>' } }],
    }),
    "https://grok2api.example/images/u_def",
  );
  assert.equal(
    videoApi.extractResponseVideoArtifact(
      {
        streamingVideoGenerationResponse: {
          progress: 100,
          videoUrl: "/users/demo/videos/final.mp4",
          thumbnailImageUrl: "/users/demo/videos/final.jpg",
          videoPostId: "post_1",
          assetId: "asset_video",
        },
      },
      "sso=demo; x-userid=user_abc",
    ).videoUrl,
    "https://assets.grok.com/users/demo/videos/final.mp4",
  );
  assert.equal(
    videoApi.extractResponseVideoArtifact(
      {
        modelResponse: {
          fileAttachments: ["asset_video"],
        },
      },
      "sso=demo; x-userid=user_abc",
    ).videoUrl,
    "https://assets.grok.com/users/user_abc/asset_video/content",
  );

  const resetPayload = imagine.buildImagineWsResetPayload();
  assert.equal(resetPayload.type, "conversation.item.create");
  assert.equal(typeof resetPayload.timestamp, "number");
  assert.deepEqual(resetPayload.item, { type: "message", content: [{ type: "reset" }] });
  assert.equal(imagine.shouldUseImagineWsForImageModel("grok-imagine-image-lite"), false);
  assert.equal(imagine.shouldUseImagineWsForImageModel("grok-imagine-image"), true);
  assert.equal(imagine.shouldUseImagineWsForImageModel("grok-imagine-image-pro"), true);
  assert.equal(
    imagine.buildExperimentalImageEditPayload({
      prompt: "edit it",
      imageReferences: ["https://assets.grok.com/users/u/asset/content"],
      modelName: "imagine-image-edit",
    }).toolOverrides,
    undefined,
  );
  assert.equal(
    imagine.replaceImageEditPlaceholders("blend @IMAGE1 with @image2; keep @IMAGE3 unchanged", [
      { fileId: "asset_a" },
      { fileId: "asset_b" },
    ]),
    "blend @asset_a with @asset_b; keep @IMAGE3 unchanged",
  );

  const imagePayload = imagine.buildImagineWsPayload("draw a cat", "req_1", "2:3", true);
  assert.equal(imagePayload.item.content[0].type, "input_text");
  assert.equal(imagePayload.item.content[0].properties.enable_side_by_side, true);
  assert.equal(imagePayload.item.content[0].properties.enable_pro, true);
  assert.equal(imagePayload.item.content[0].properties.aspect_ratio, "2:3");
  assert.equal(
    imagine.extractImagineImageIdFromUrl("https://assets.grok.com/users/demo/images/3f5e21f6-6c7d-48ca-a7aa-337b5591fb41.jpg?x=1"),
    "3f5e21f6-6c7d-48ca-a7aa-337b5591fb41",
  );

  const generatedCardImage = imageCards.extractImageChunkFromCardAttachment({
    jsonData: JSON.stringify({
      id: "card_1",
      image_chunk: {
        progress: 100,
        imageUuid: "img_1",
        imageUrl: "users/demo/generated/example.jpg",
        moderated: false,
      },
    }),
  });
  assert.deepEqual(generatedCardImage, {
    progress: 100,
    imageUuid: "img_1",
    url: "https://assets.grok.com/users/demo/generated/example.jpg",
    moderated: false,
  });

  assert.equal(
    imageCards.extractImageChunkFromCardAttachment({
      jsonData: JSON.stringify({
        image_chunk: {
          progress: 100,
          imageUrl: "/users/demo/generated/blocked.jpg",
          moderated: true,
        },
      }),
    })?.url,
    undefined,
  );

  assert.deepEqual(
    imageCards.extractModelResponseImageUrls(
      {
        fileAttachments: ["asset_123"],
      },
      "sso=demo; x-userid=user_abc",
    ),
    ["https://assets.grok.com/users/user_abc/asset_123/content"],
  );

  assert.deepEqual(
    imageCards.extractResponseImageUrls(
      {
        streamingImageGenerationResponse: {
          progress: 100,
          imageUrl: "/users/demo/generated/final.jpg",
          moderated: false,
        },
      },
      "sso=demo; x-userid=user_abc",
    ),
    ["https://assets.grok.com/users/demo/generated/final.jpg"],
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
