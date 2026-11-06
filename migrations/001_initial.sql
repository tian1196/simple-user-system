-- Device Ledger schema 1. SQLite >= 3.26. No default accounts or passwords.
-- This is a one-time migration for a NEW database, never an upgrade script.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
BEGIN IMMEDIATE;
CREATE TABLE schema_migrations (
 version INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 applied_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000)
);
CREATE TABLE users (
 id TEXT PRIMARY KEY NOT NULL,
 username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 4 AND 32 AND username NOT GLOB '*[^a-z0-9_]*'),
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','operator','owner')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 mfa_secret_enc TEXT,
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 last_login_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1)
);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created ON users(created_at,id);
CREATE TABLE auth_identities (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('password','wechat_mini','phone')),
 provider_key TEXT NOT NULL CHECK(length(provider_key)>0),
 password_hash TEXT,
 recovery_code_hash TEXT,
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 UNIQUE(provider,provider_key), UNIQUE(user_id,provider),
 CHECK(provider<>'password' OR (password_hash IS NOT NULL AND length(password_hash)>0))
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_type TEXT NOT NULL DEFAULT 'web' CHECK(client_type IN ('web','admin','miniapp')),
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 last_seen_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 expires_at INTEGER NOT NULL,
 reauthenticated_at INTEGER,
 CHECK(expires_at>created_at)
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE invite_codes (
 id TEXT PRIMARY KEY NOT NULL,
 code_hash TEXT NOT NULL UNIQUE,
 max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses BETWEEN 1 AND 20),
 used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0 AND used_count<=max_uses),
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000)
);
CREATE INDEX idx_invites_expiry ON invite_codes(expires_at);
CREATE INDEX idx_invites_creator ON invite_codes(created_by);
CREATE TABLE devices (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('appliance','computer','camera','digital','other')),
 model TEXT CHECK(model IS NULL OR length(model)<=80),
 purchased_on TEXT CHECK(purchased_on IS NULL OR (length(purchased_on)=10 AND purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(purchased_on,'+0 days') IS purchased_on)),
 warranty_until TEXT CHECK(warranty_until IS NULL OR (length(warranty_until)=10 AND warranty_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(warranty_until,'+0 days') IS warranty_until)),
 note TEXT CHECK(note IS NULL OR length(note)<=500),
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 CHECK(purchased_on IS NULL OR warranty_until IS NULL OR warranty_until>=purchased_on)
);
CREATE INDEX idx_devices_owner_created ON devices(user_id,created_at,id);
CREATE INDEX idx_devices_owner_warranty ON devices(user_id,warranty_until);
CREATE TABLE maintenance_plans (
 id TEXT PRIMARY KEY NOT NULL,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),
 interval_days INTEGER NOT NULL CHECK(typeof(interval_days)='integer' AND interval_days BETWEEN 1 AND 3650),
 next_due_on TEXT NOT NULL CHECK(length(next_due_on)=10 AND next_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(next_due_on,'+0 days') IS next_due_on),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1)
);
CREATE INDEX idx_plans_device ON maintenance_plans(device_id);
CREATE INDEX idx_plans_due ON maintenance_plans(status,next_due_on);
CREATE TABLE maintenance_logs (
 id TEXT PRIMARY KEY NOT NULL,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 plan_id TEXT REFERENCES maintenance_plans(id) ON DELETE SET NULL,
 source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','plan')),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),
 completed_on TEXT NOT NULL CHECK(length(completed_on)=10 AND completed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(completed_on,'+0 days') IS completed_on),
 note TEXT CHECK(note IS NULL OR length(note)<=500),
 request_key TEXT NOT NULL CHECK(length(request_key)>0),
 request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)>0),
 previous_due_on TEXT CHECK(previous_due_on IS NULL OR (length(previous_due_on)=10 AND date(previous_due_on,'+0 days') IS previous_due_on)),
 plan_version_after INTEGER CHECK(plan_version_after IS NULL OR plan_version_after>=1),
 voided_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 UNIQUE(device_id,request_key),
 CHECK((source='manual' AND plan_id IS NULL AND previous_due_on IS NULL AND plan_version_after IS NULL) OR (source='plan' AND previous_due_on IS NOT NULL AND plan_version_after IS NOT NULL))
);
CREATE INDEX idx_logs_device_date ON maintenance_logs(device_id,completed_on,id);
CREATE INDEX idx_logs_plan_created ON maintenance_logs(plan_id,created_at,id);
-- Enforce plan/device consistency, including direct SQL writes.
CREATE TRIGGER trg_logs_plan_device_insert BEFORE INSERT ON maintenance_logs
 WHEN NEW.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM maintenance_plans WHERE id=NEW.plan_id AND device_id=NEW.device_id)
 BEGIN SELECT RAISE(ABORT,'plan_device_mismatch'); END;
CREATE TRIGGER trg_logs_plan_device_update BEFORE UPDATE OF plan_id,device_id ON maintenance_logs
 WHEN NEW.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM maintenance_plans WHERE id=NEW.plan_id AND device_id=NEW.device_id)
 BEGIN SELECT RAISE(ABORT,'plan_device_mismatch'); END;
CREATE TRIGGER trg_plan_device_immutable BEFORE UPDATE OF device_id ON maintenance_plans
 WHEN NEW.device_id<>OLD.device_id BEGIN SELECT RAISE(ABORT,'plan_device_immutable'); END;
CREATE TABLE app_settings (
 key TEXT PRIMARY KEY NOT NULL CHECK(key IN ('registration_enabled','writes_enabled')),
 value_json TEXT NOT NULL CHECK(value_json IN ('true','false')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000)
);
CREATE INDEX idx_settings_actor ON app_settings(updated_by);
CREATE TABLE privacy_acceptances (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 policy_version TEXT NOT NULL CHECK(length(policy_version)>0),
 accepted_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 UNIQUE(user_id,policy_version)
);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY NOT NULL,
 actor_user_id TEXT,
 action TEXT NOT NULL,
 target_type TEXT,
 target_id TEXT,
 result TEXT NOT NULL CHECK(result IN ('success','failure')),
 request_id TEXT NOT NULL,
 source_ip TEXT,
 detail_json TEXT,
 created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000)
);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id,created_at);
CREATE INDEX idx_audit_action_time ON audit_logs(action,created_at);
CREATE INDEX idx_audit_request ON audit_logs(request_id);
CREATE TABLE deletion_tombstones (
 user_id TEXT PRIMARY KEY NOT NULL,
 deleted_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
 purge_after INTEGER NOT NULL,
 CHECK(purge_after>deleted_at)
);
CREATE INDEX idx_tombstones_purge ON deletion_tombstones(purge_after);
INSERT INTO app_settings(key,value_json) VALUES('registration_enabled','true'),('writes_enabled','true');
INSERT INTO schema_migrations(version,name) VALUES(1,'001_initial');
PRAGMA user_version = 1;
COMMIT;
