ALTER TABLE audit_log ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
CREATE INDEX checkin_history ON audit_log(org_id,subject,id) WHERE action IN ('checkin.confirmed','checkin.corrected');
