CREATE TABLE rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);
CREATE FUNCTION protect_published_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published AND (NEW.policy IS DISTINCT FROM OLD.policy OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash OR NEW.policy_address IS DISTINCT FROM OLD.policy_address OR NOT NEW.published) THEN
   RAISE EXCEPTION 'Published policy is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_policy BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION protect_published_policy();
