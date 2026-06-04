CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  seconds TEXT NOT NULL,
  size TEXT NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  video_url TEXT NOT NULL DEFAULT '',
  content_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_updated_at ON video_jobs(updated_at);
