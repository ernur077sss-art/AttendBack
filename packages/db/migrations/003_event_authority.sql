ALTER TABLE events ADD COLUMN authority text;
UPDATE events e SET authority=(SELECT wallet FROM memberships m WHERE m.org_id=e.org_id AND m.role='owner' ORDER BY wallet LIMIT 1);
ALTER TABLE events ALTER COLUMN authority SET NOT NULL;
