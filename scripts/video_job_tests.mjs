import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const outDir = mkdtempSync(join(tmpdir(), "grok2api-video-job-"));

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

function makeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (/INSERT INTO video_jobs/i.test(sql)) {
                const [
                  id,
                  model,
                  prompt,
                  seconds,
                  size,
                  quality,
                  status,
                  progress,
                  createdAt,
                  completedAt,
                  error,
                  videoUrl,
                  contentUrl,
                  updatedAt,
                ] = params;
                rows.set(id, {
                  id,
                  model,
                  prompt,
                  seconds,
                  size,
                  quality,
                  status,
                  progress,
                  created_at: createdAt,
                  completed_at: completedAt,
                  error,
                  video_url: videoUrl,
                  content_url: contentUrl,
                  updated_at: updatedAt,
                });
              } else if (/UPDATE video_jobs SET status = \?/i.test(sql)) {
                const [status, progress, completedAt, error, videoUrl, contentUrl, updatedAt, id] = params;
                const row = rows.get(id);
                if (row) {
                  Object.assign(row, {
                    status,
                    progress,
                    completed_at: completedAt,
                    error,
                    video_url: videoUrl,
                    content_url: contentUrl,
                    updated_at: updatedAt,
                  });
                }
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (/SELECT .+ FROM video_jobs WHERE id = \?/is.test(sql)) {
                return rows.get(params[0]) ?? null;
              }
              return null;
            },
          };
        },
      };
    },
  };
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

  const jobs = await import(pathToFileURL(join(outDir, "src/repo/videoJobs.js")));
  const db = makeDb();

  const created = await jobs.createVideoJob(db, {
    model: "grok-imagine-video",
    prompt: "city skyline",
    seconds: "6",
    size: "720x1280",
  });
  assert.match(created.id, /^video_/);
  assert.equal(created.status, "queued");
  assert.equal(created.progress, 0);

  const running = await jobs.updateVideoJob(db, created.id, { status: "in_progress", progress: 35 });
  assert.equal(running?.status, "in_progress");
  assert.equal(running?.progress, 35);

  const done = await jobs.updateVideoJob(db, created.id, {
    status: "completed",
    progress: 100,
    video_url: "https://assets.grok.com/video.mp4",
    content_url: "https://worker.example/images/u_video",
  });
  assert.equal(done?.status, "completed");
  assert.equal(done?.content_url, "https://worker.example/images/u_video");
  assert.equal(done?.completed_at > 0, true);

  const fetched = await jobs.getVideoJob(db, created.id);
  assert.deepEqual(fetched, done);
  assert.equal(jobs.videoJobToResponse(done).object, "video");
  assert.equal(jobs.videoJobToResponse(done).content_url, "https://worker.example/images/u_video");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
