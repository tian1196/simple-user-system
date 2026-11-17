CREATE TABLE reminder_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 warranty_enabled INTEGER NOT NULL CHECK(warranty_enabled IN (0,1)),
 warranty_days INTEGER NOT NULL CHECK(warranty_days IN (1,3,7,14,30)),
 maintenance_enabled INTEGER NOT NULL CHECK(maintenance_enabled IN (0,1)),
 maintenance_days INTEGER NOT NULL CHECK(maintenance_days IN (0,1,3,7)),
 version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE TABLE reminder_snoozes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 plan_id TEXT REFERENCES maintenance_plans(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('plan','warranty')),
 target_id TEXT NOT NULL,
 due_on TEXT NOT NULL,
 until_on TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,kind,target_id),
 CHECK((kind='plan' AND plan_id IS NOT NULL) OR (kind='warranty' AND plan_id IS NULL))
);
INSERT INTO schema_migrations(version,name) VALUES(2,'002_reminders');
PRAGMA user_version=2;
