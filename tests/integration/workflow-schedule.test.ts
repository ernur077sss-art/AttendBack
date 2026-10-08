import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { pool } from '../../packages/db/src';
import { migrate } from '../../packages/db/src/migrate';
import { nextReconciliationAt } from '../../packages/server/src/workflow-schedule';

beforeEach(async () => {
  expect(
    (
      await pool.query('select current_database() as name')
    ).rows[0].name.endsWith('_test'),
  ).toBe(true);
  await migrate();
  await pool.query(
    'truncate organizations, outbox, transaction_intents cascade',
  );
});
afterAll(() => pool.end());

test('an idle app sleeps for a day so Neon can suspend', async () => {
  expect((await nextReconciliationAt()).getTime() - Date.now()).toBeGreaterThan(
    86_390_000,
  );
});

test('pending jobs respect active leases and resume promptly after expiry', async () => {
  const id = randomUUID();
  await pool.query(
    "insert into outbox(id,dedup_key,kind,status,lease_until) values($1,$2,'notify','leased',now()+interval '10 minutes')",
    [id, id],
  );
  const due = (await nextReconciliationAt()).getTime() - Date.now();
  expect(due).toBeGreaterThan(590_000);
  expect(due).toBeLessThan(610_000);
  await pool.query(
    "update outbox set lease_until=now()-interval '1 second' where id=$1",
    [id],
  );
  expect(
    (await nextReconciliationAt()).getTime() - Date.now(),
  ).toBeLessThanOrEqual(15_000);
});

test('funded events wake at policy deadlines; unpaid released seats cause no polling', async () => {
  const org = randomUUID(),
    event = randomUUID(),
    session = randomUUID(),
    registration = randomUUID();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  await pool.query(
    "insert into organizations(id,name) values($1,'Schedule fixture')",
    [org],
  );
  await pool.query(
    "insert into events(id,org_id,title,location,cancel_deadline,authority) values($1,$2,'Fixture','Localhost',0,'test-owner')",
    [event, org],
  );
  await pool.query(
    "insert into sessions(id,event_id,title,capacity,policy,terms_hash) values($1,$2,'Fixture',1,$3,'test')",
    [
      session,
      event,
      JSON.stringify({ checkinClose: deadline, hardRefundAt: deadline + 1800 }),
    ],
  );
  await pool.query(
    "insert into registrations(id,session_id,wallet,seat_state,deposit_state) values($1,$2,'test-wallet','Active','Funded')",
    [registration, session],
  );
  expect((await nextReconciliationAt()).getTime()).toBe((deadline + 5) * 1000);
  // A bounded batch may not have reached this deposit when its deadline passed.
  // Keep waking until the due action has been scheduled, instead of sleeping past the proposal cutoff.
  await pool.query('update sessions set policy=$1 where id=$2', [
    JSON.stringify({
      checkinClose: deadline - 700,
      proposalCutoff: deadline + 100,
      hardRefundAt: deadline + 1800,
    }),
    session,
  ]);
  expect(
    (await nextReconciliationAt()).getTime() - Date.now(),
  ).toBeLessThanOrEqual(15_000);
  await pool.query(
    "update registrations set seat_state='Released',deposit_state=null where id=$1",
    [registration],
  );
  expect((await nextReconciliationAt()).getTime() - Date.now()).toBeGreaterThan(
    86_390_000,
  );
});
