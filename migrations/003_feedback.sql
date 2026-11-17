CREATE TABLE feedback (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('issue','suggestion','experience')),
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 contact TEXT NOT NULL DEFAULT '',
 diagnostics_json TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','resolved')),
 reply TEXT NOT NULL DEFAULT '',
 internal_note TEXT NOT NULL DEFAULT '',
 replied_at INTEGER,
 request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(user_id,request_key)
);
CREATE TABLE feedback_attachments (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 feedback_id TEXT REFERENCES feedback(id) ON DELETE CASCADE,
 upload_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 filename TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,upload_key)
);
CREATE TABLE feedback_history (
 id TEXT PRIMARY KEY,
 feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_user_date ON feedback(user_id,created_at DESC,seq DESC);
CREATE INDEX idx_feedback_status_date ON feedback(status,created_at DESC,seq DESC);
CREATE INDEX idx_feedback_attachment_user ON feedback_attachments(user_id,created_at);
CREATE INDEX idx_feedback_history_record ON feedback_history(feedback_id,created_at);
INSERT INTO schema_migrations(version,name) VALUES(3,'003_feedback');
PRAGMA user_version=3;
