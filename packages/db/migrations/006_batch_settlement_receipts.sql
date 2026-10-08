-- A permissionless transaction can settle several commitments at once.
-- Idempotency belongs to the registration, not the transaction signature.
ALTER TABLE ledger DROP CONSTRAINT ledger_signature_key;
CREATE INDEX ledger_signature ON ledger(signature);
