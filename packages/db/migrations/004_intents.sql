CREATE TABLE transaction_intents (
 id uuid PRIMARY KEY, wallet text NOT NULL, registration_id uuid REFERENCES registrations,
 session_id uuid REFERENCES sessions, event_id uuid REFERENCES events,
 kind text NOT NULL, wire_transaction text NOT NULL, signature text UNIQUE,
 last_valid_block_height bigint NOT NULL, permit_expires bigint,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','finalized','expired','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), error_code text
);
CREATE INDEX pending_intents ON transaction_intents(created_at) WHERE status IN ('prepared','submitted');
