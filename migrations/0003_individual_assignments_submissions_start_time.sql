PRAGMA foreign_keys = ON;

-- Task start date/time. Existing tasks remain valid with NULL start_time.
ALTER TABLE tasks ADD COLUMN start_time TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_division ON tasks(division_id);

-- Immutable submission versions: resetting progress or activity logs never removes these rows.
CREATE TABLE IF NOT EXISTS submission_records (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  member_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS submission_attachments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submission_records(id) ON DELETE CASCADE,
  attachment_type TEXT NOT NULL CHECK(attachment_type IN ('file','link')),
  object_key TEXT,
  url TEXT,
  original_name TEXT,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (attachment_type = 'file' AND object_key IS NOT NULL AND url IS NULL) OR
    (attachment_type = 'link' AND url IS NOT NULL AND object_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_submission_assignment ON submission_records(assignment_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submission_attachment_parent ON submission_attachments(submission_id);


CREATE TABLE IF NOT EXISTS submission_reviews (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submission_records(id) ON DELETE SET NULL,
  reviewer_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('completed','revision')),
  note TEXT,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submission_reviews_assignment ON submission_reviews(assignment_id, reviewed_at DESC);

-- Preserve review decisions from the old activity log before Activity History can be reset.
INSERT INTO submission_reviews (id, assignment_id, submission_id, reviewer_id, status, note, reviewed_at)
SELECT lower(hex(randomblob(16))), l.target_id, NULL, l.actor_id,
       CASE WHEN l.action='task_approved' THEN 'completed' ELSE 'revision' END,
       json_extract(l.details, '$.note'), l.created_at
FROM activity_logs l
JOIN task_assignments a ON a.id=l.target_id
WHERE l.target_type='assignment' AND l.action IN ('task_approved','revision_requested');
