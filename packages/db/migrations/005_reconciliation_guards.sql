ALTER TABLE ledger ADD CONSTRAINT one_settlement_per_registration UNIQUE(registration_id);
ALTER TABLE registrations ADD COLUMN sync_error text;
