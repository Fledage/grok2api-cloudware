import type { Env } from "../env";
import { dbFirst, dbRun } from "../db";
import { nowMs } from "../utils/time";
import { VIDEO_MODEL_ID, VIDEO_QUALITY } from "../grok/video";

export type VideoJobStatus = "queued" | "in_progress" | "completed" | "failed";

export interface VideoJobRow {
  id: string;
  model: string;
  prompt: string;
  seconds: string;
  size: string;
  quality: string;
  status: VideoJobStatus;
  progress: number;
  created_at: number;
  completed_at: number | null;
  error: string | null;
  video_url: string;
  content_url: string;
  updated_at: number;
}

export interface CreateVideoJobInput {
  model?: string;
  prompt: string;
  seconds: string;
  size: string;
  quality?: string;
}

export interface UpdateVideoJobInput {
  status?: VideoJobStatus;
  progress?: number;
  completed_at?: number | null;
  error?: string | null;
  video_url?: string;
  content_url?: string;
}

function clampProgress(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function completedAtFor(status: VideoJobStatus, value?: number | null): number | null {
  if (typeof value === "number") return value;
  if (status === "completed" || status === "failed") return nowMs();
  return null;
}

export async function createVideoJob(db: Env["DB"], input: CreateVideoJobInput): Promise<VideoJobRow> {
  const now = nowMs();
  const row: VideoJobRow = {
    id: `video_${crypto.randomUUID().replace(/-/g, "")}`,
    model: String(input.model || VIDEO_MODEL_ID),
    prompt: input.prompt,
    seconds: input.seconds,
    size: input.size,
    quality: input.quality || VIDEO_QUALITY,
    status: "queued",
    progress: 0,
    created_at: now,
    completed_at: null,
    error: null,
    video_url: "",
    content_url: "",
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO video_jobs(id,model,prompt,seconds,size,quality,status,progress,created_at,completed_at,error,video_url,content_url,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.model,
      row.prompt,
      row.seconds,
      row.size,
      row.quality,
      row.status,
      row.progress,
      row.created_at,
      row.completed_at,
      row.error,
      row.video_url,
      row.content_url,
      row.updated_at,
    ],
  );
  return row;
}

export async function getVideoJob(db: Env["DB"], id: string): Promise<VideoJobRow | null> {
  return dbFirst<VideoJobRow>(
    db,
    "SELECT id,model,prompt,seconds,size,quality,status,progress,created_at,completed_at,error,video_url,content_url,updated_at FROM video_jobs WHERE id = ?",
    [id],
  );
}

export async function updateVideoJob(db: Env["DB"], id: string, input: UpdateVideoJobInput): Promise<VideoJobRow | null> {
  const current = await getVideoJob(db, id);
  if (!current) return null;
  const status = input.status ?? current.status;
  const progress = clampProgress(input.progress ?? current.progress);
  const completed_at =
    input.completed_at !== undefined ? input.completed_at : completedAtFor(status, current.completed_at);
  const error = input.error !== undefined ? input.error : current.error;
  const video_url = input.video_url !== undefined ? input.video_url : current.video_url;
  const content_url = input.content_url !== undefined ? input.content_url : current.content_url;
  const updated_at = nowMs();

  await dbRun(
    db,
    `UPDATE video_jobs SET status = ?, progress = ?, completed_at = ?, error = ?, video_url = ?, content_url = ?, updated_at = ? WHERE id = ?`,
    [status, progress, completed_at, error, video_url, content_url, updated_at, id],
  );
  return getVideoJob(db, id);
}

export function videoJobToResponse(row: VideoJobRow): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: row.id,
    object: "video",
    created_at: Math.floor(row.created_at / 1000),
    status: row.status,
    model: row.model,
    progress: row.progress,
    prompt: row.prompt,
    seconds: row.seconds,
    size: row.size,
    quality: row.quality,
  };
  if (row.completed_at) payload.completed_at = Math.floor(row.completed_at / 1000);
  if (row.error) payload.error = { message: row.error };
  if (row.content_url) payload.content_url = row.content_url;
  if (row.video_url) payload.video_url = row.video_url;
  return payload;
}
