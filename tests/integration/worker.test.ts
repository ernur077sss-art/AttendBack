import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  signTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import { pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import {
  createOrganization,
  createEvent,
  reserve,
  addMember,
  ticket,
  checkin,
  enqueue,
} from '../../packages/server/src/service';
import {
  publicConfig,
  preparePublication,
  prepareDeposit,
  submitIntent,
  syncPublication,
} from '../../packages/server/src/chain-service';
import * as chain from '../../packages/server/src/chain';
import { claimJob, processJob, tick } from '../../packages/server/src/jobs';
import { syncDeposit, reconcileIntents } from '../../packages/server/src/sync';
beforeAll(async () => {
  expect(
    (
      await pool.query('select current_database() as name')
    ).rows[0].name.endsWith('_test'),
  ).toBe(true);
  await migrate();
  await pool.query('truncate organizations cascade');
});
afterAll(() => pool.end());
async function final(sig: string) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const s = await chain.signatureStatus(sig);
    if (s?.err) throw new Error(JSON.stringify(s.err));
    if (s?.confirmationStatus === 'finalized') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Finality timed out');
}
async function send(
  signer: KeyPairSigner,
  intent: Awaited<ReturnType<typeof preparePublication>>,
) {
  const signed = await signTransaction(
    [signer.keyPair],
    getTransactionDecoder().decode(Buffer.from(intent.transaction, 'base64')),
  );
  const result = await submitIntent(
    signer.address,
    intent.id,
    getBase64EncodedWireTransaction(signed),
  );
  await final(result.signature);
  await reconcileIntents();
}
async function fixture() {
  const owner = await chain.localSigner('owner'),
    guest = await chain.localSigner('guest'),
    guest2 = await chain.localSigner('guest2'),
    staff = await chain.localSigner('staff');
  const cfg = await publicConfig(),
    n = await chain.chainTime();
  const org = await createOrganization(owner.address, 'Worker integration');
  await addMember(owner.address, org.id, staff.address, 'staff');
  const event = await createEvent(owner.address, org.id, {
    title: 'Worker integration event',
    description: 'Local end-to-end',
    location: 'Localhost',
    capacity: 1,
    policy: {
      amount: '1000000',
      penaltyBps: 5000,
      mint: cfg.mint,
      bookingAuthority: cfg.bookingAuthority,
      attester: cfg.attester,
      resolver: owner.address,
      penaltyRecipient: owner.address,
      bookingClose: n + 300,
      freeCancelUntil: n - 30,
      checkinOpen: n - 20,
      checkinClose: n + 400,
      proposalCutoff: n + 500,
      disputeDeadline: n + 600,
      resolutionDeadline: n + 700,
      hardRefundAt: n + 800,
    },
  });
  await send(
    owner,
    await preparePublication(owner.address, event.sessionId, 1),
  );
  await syncPublication(event.sessionId);
  const r = await reserve(guest.address, event.sessionId);
  await send(guest, await prepareDeposit(guest.address, r.id, 0));
  await syncDeposit(r.id);
  return { owner, guest, guest2, staff, event, r };
}
test('stage 6: crash after persistence resends identical bytes, pays once, keeps attended seat and records finalized ledger', async () => {
  const f = await fixture();
  expect((await reserve(f.guest2.address, f.event.sessionId)).seat_state).toBe(
    'Waitlisted',
  );
  const qr = await ticket(f.r.id, f.guest.address);
  await checkin(f.staff.address, f.event.id, qr.token);
  await pool.query(
    "update checkins set eligible_at=now()-interval '1 second' where registration_id=$1",
    [f.r.id],
  );
  const candidates = await Promise.all([
    claimJob(randomUUID()),
    claimJob(randomUUID()),
  ]);
  expect(candidates.filter(Boolean)).toHaveLength(1);
  const job = candidates.find(Boolean)!;
  await expect(
    processJob(job, {
      afterPersist: async () => {
        throw new Error('SIMULATED_CRASH');
      },
    }),
  ).rejects.toThrow('SIMULATED_CRASH');
  const saved = (await pool.query('select * from outbox where id=$1', [job.id]))
    .rows[0];
  expect(saved.signature).toBeTruthy();
  expect(saved.wire_transaction).toBeTruthy();
  expect(await chain.signatureStatus(saved.signature)).toBeNull();
  await pool.query(
    "update outbox set lease_until=now()-interval '1 second' where id=$1",
    [job.id],
  );
  const resumed = await claimJob(randomUUID());
  expect(resumed.signature).toBe(saved.signature);
  expect(resumed.wire_transaction).toBe(saved.wire_transaction);
  await processJob(resumed);
  await final(saved.signature);
  await syncDeposit(f.r.id);
  expect(
    (
      await pool.query('select seat_state from registrations where id=$1', [
        f.r.id,
      ])
    ).rows[0].seat_state,
  ).toBe('Active');
  const confirmed = await claimJob(randomUUID());
  await processJob(confirmed);
  const settlement = await claimJob(randomUUID());
  expect(settlement.kind).toBe('settle');
  await processJob(settlement);
  const payment = (
    await pool.query('select * from outbox where id=$1', [settlement.id])
  ).rows[0];
  await final(payment.signature);
  await syncDeposit(f.r.id);
  await processJob({ ...payment, lease_owner: payment.lease_owner });
  await syncDeposit(f.r.id);
  const ledger = (
    await pool.query('select * from ledger where registration_id=$1', [f.r.id])
  ).rows;
  expect(ledger).toHaveLength(1);
  expect(ledger[0].refund).toBe('1000000');
  expect(ledger[0].penalty).toBe('0');
  expect(ledger[0].signature).toBe(payment.signature);
  expect(
    (
      await pool.query(
        'select seat_state,deposit_state from registrations where id=$1',
        [f.r.id],
      )
    ).rows[0],
  ).toMatchObject({ seat_state: 'Active', deposit_state: 'Settled' });
  expect((await reserve(f.guest2.address, f.event.sessionId)).seat_state).toBe(
    'Waitlisted',
  );
}, 60000);
test('stage 6: unavailable chain data keeps PaymentPending capacity without stopping unrelated worker jobs', async () => {
  const f = await fixture();
  const before = (
    await pool.query('select * from registrations where id=$1', [f.r.id])
  ).rows[0];
  await pool.query(
    "update registrations set seat_state='PaymentPending',reserved_until=now()-interval '1 day',permit_expires=1,permit_last_valid_block_height=1 where id=$1",
    [f.r.id],
  );
  const operation = `test-notice:${randomUUID()}`;
  await enqueue(pool, 'notify', f.r.id, operation, {
    wallet: f.guest.address,
    message: operation,
  });
  const originalSnapshot = chain.depositSnapshot;
  const unavailable = vi
    .spyOn(chain, 'depositSnapshot')
    .mockImplementation((event, policy, commitment, minSlot) => {
      if (commitment === before.deposit_address)
        throw new Error('RPC unavailable');
      return originalSnapshot(event, policy, commitment, minSlot);
    });
  try {
    await tick(randomUUID(), 50);
    expect(
      (
        await pool.query('select seat_state from registrations where id=$1', [
          f.r.id,
        ])
      ).rows[0].seat_state,
    ).toBe('PaymentPending');
    expect(
      (
        await pool.query('select message from notifications where message=$1', [
          operation,
        ])
      ).rows,
    ).toEqual([{ message: operation }]);
    expect(
      (
        await pool.query('select sync_error from registrations where id=$1', [
          f.r.id,
        ])
      ).rows[0].sync_error,
    ).toBe('RPC_RECHECK');
  } finally {
    unavailable.mockRestore();
    await pool.query(
      'update registrations set seat_state=$1,reserved_until=$2,permit_expires=$3,permit_last_valid_block_height=$4 where id=$5',
      [
        before.seat_state,
        before.reserved_until,
        before.permit_expires,
        before.permit_last_valid_block_height,
        f.r.id,
      ],
    );
  }
}, 60000);
test('stage 8: finalized chain transaction retries its projection after a transient RPC failure', async () => {
  const f = await fixture();
  const intent = (
    await pool.query(
      "update transaction_intents set status='submitted' where registration_id=$1 and kind='deposit' returning id",
      [f.r.id],
    )
  ).rows[0];
  const unavailable = vi
    .spyOn(chain, 'depositSnapshot')
    .mockRejectedValueOnce(new Error('RPC unavailable'));
  try {
    await reconcileIntents();
    expect(
      (
        await pool.query(
          'select status,error_code from transaction_intents where id=$1',
          [intent.id],
        )
      ).rows[0],
    ).toEqual({ status: 'submitted', error_code: 'RPC_RECHECK' });
  } finally {
    unavailable.mockRestore();
  }
  await reconcileIntents();
  expect(
    (
      await pool.query(
        'select status,error_code from transaction_intents where id=$1',
        [intent.id],
      )
    ).rows[0],
  ).toEqual({ status: 'finalized', error_code: null });
}, 60000);
