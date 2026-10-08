import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, afterAll, expect, test, vi } from 'vitest';
import {
  address,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  signTransaction,
  type KeyPairSigner,
  type Instruction,
} from '@solana/kit';
import { pool } from '../../packages/db/src';
import { migrate } from '../../packages/db/src/migrate';
import {
  createEvent,
  createOrganization,
  reserve,
} from '../../packages/server/src/service';
import {
  prepareDeposit,
  prepareEventCancel,
  preparePublication,
  publicConfig,
  settlementInstructions,
  submitIntent,
} from '../../packages/server/src/chain-service';
import * as chain from '../../packages/server/src/chain';
import {
  loadRegistration,
  reconcileIntents,
  scheduleDue,
  syncDeposit,
} from '../../packages/server/src/sync';

beforeEach(async () => {
  expect(
    (
      await pool.query('select current_database() as name')
    ).rows[0].name.endsWith('_test'),
  ).toBe(true);
  await migrate();
  await pool.query('truncate organizations cascade');
});
afterAll(() => pool.end());

async function finalized(signature: string) {
  await vi.waitFor(
    async () => {
      const status = await chain.signatureStatus(signature);
      expect(status?.err).toBeFalsy();
      expect(status?.confirmationStatus).toBe('finalized');
    },
    { timeout: 20000, interval: 100 },
  );
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
  await finalized(result.signature);
  await reconcileIntents();
}
async function fixture(guestCount = 2) {
  const owner = await chain.localSigner('owner');
  const cfg = await publicConfig(),
    n = await chain.chainTime();
  const org = await createOrganization(owner.address, 'Reconciliation test');
  const event = await createEvent(owner.address, org.id, {
    title: 'Reconciliation test',
    description: 'Synthetic localnet fixture',
    location: 'Localhost',
    capacity: 2,
    policy: {
      amount: '1000000',
      penaltyBps: 5000,
      mint: cfg.mint,
      bookingAuthority: cfg.bookingAuthority,
      attester: cfg.attester,
      resolver: owner.address,
      penaltyRecipient: owner.address,
      bookingClose: n + 300,
      freeCancelUntil: n + 100,
      checkinOpen: n + 200,
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
  const registrations = [];
  for (const role of ['guest', 'guest2'].slice(0, guestCount)) {
    const guest = await chain.localSigner(role);
    const registration = await reserve(guest.address, event.sessionId);
    await send(guest, await prepareDeposit(guest.address, registration.id, 0));
    registrations.push(await loadRegistration(registration.id));
  }
  return { owner, event, registrations, n };
}

test('stages 5–6: batched external settlement recovers after a DB projection failure with separate idempotent receipts and notices', async () => {
  const f = await fixture();
  await send(f.owner, await prepareEventCancel(f.owner.address, f.event.id, 0));
  const instructions = (
    await Promise.all(
      f.registrations.map((r) => settlementInstructions(f.owner, r)),
    )
  ).flat();
  const prepared = await chain.prepare(f.owner, instructions, 0);
  const signature = await chain.broadcast(prepared.wire);
  await finalized(signature);
  // Reject the ledger write after state/seat updates, proving the projection rolls back.
  await pool.query(
    'alter table ledger add constraint test_reject_receipt check (false) not valid',
  );
  try {
    await expect(syncDeposit(f.registrations[0].id)).rejects.toMatchObject({
      code: '23514',
    });
    expect(
      (await pool.query('select count(*)::int as n from ledger')).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'select seat_state,deposit_state from registrations where id=$1',
          [f.registrations[0].id],
        )
      ).rows[0],
    ).toMatchObject({ seat_state: 'Active', deposit_state: 'Funded' });
  } finally {
    await pool.query('alter table ledger drop constraint test_reject_receipt');
  }
  for (const r of [...f.registrations, ...f.registrations])
    await syncDeposit(r.id);
  const receipts = (
    await pool.query(
      'select registration_id,signature,slot,refund,penalty from ledger order by registration_id',
    )
  ).rows;
  expect(receipts).toHaveLength(2);
  expect(new Set(receipts.map((r) => r.registration_id)).size).toBe(2);
  for (const r of receipts)
    expect(r).toMatchObject({
      signature,
      slot: (await chain.signatureStatus(signature))!.slot.toString(),
      refund: '1000000',
      penalty: '0',
    });
  const notices = (
    await pool.query(
      "select registration_id from outbox where kind='notify' and dedup_key like 'settlement-notice:%'",
    )
  ).rows;
  expect(new Set(notices.map((r) => r.registration_id))).toEqual(
    new Set(f.registrations.map((r) => r.id)),
  );
  expect(notices).toHaveLength(2);
}, 60000);

test('stage 6: a newer settlement mentioning another commitment as a remaining account cannot replace its receipt', async () => {
  const f = await fixture();
  await send(f.owner, await prepareEventCancel(f.owner.address, f.event.id, 0));
  const first = await chain.prepare(
    f.owner,
    await settlementInstructions(f.owner, f.registrations[0]),
    0,
  );
  const firstSignature = await chain.broadcast(first.wire);
  await finalized(firstSignature);
  const instructions: Instruction[] = await settlementInstructions(
    f.owner,
    f.registrations[1],
  );
  const settle = instructions[2];
  instructions[2] = {
    ...settle,
    accounts: [
      ...settle.accounts!,
      { address: address(f.registrations[0].deposit_address), role: 0 },
    ],
  };
  const second = await chain.prepare(f.owner, instructions, 0);
  const secondSignature = await chain.broadcast(second.wire);
  await finalized(secondSignature);
  await syncDeposit(f.registrations[0].id);
  expect(
    (
      await pool.query(
        'select signature from ledger where registration_id=$1',
        [f.registrations[0].id],
      )
    ).rows[0].signature,
  ).toBe(firstSignature);
}, 60000);

test('stage 6: expired unpaid registrations do not starve funded deposits or schedule nonexistent refunds', async () => {
  const f = await fixture(1),
    paid = f.registrations[0];
  const snapshot = await chain.depositSnapshot(
    address(paid.event_address),
    address(paid.policy_address),
    address(paid.deposit_address),
  );
  for (const seat of ['Released', 'PaymentPending']) {
    for (let i = 0; i < 100; i++) {
      const id = randomUUID();
      await pool.query(
        "insert into registrations(id,session_id,wallet,seat_state,deposit_address,updated_at) values($1,$2,$3,$4,$5,'2000-01-01')",
        [
          id,
          f.event.sessionId,
          getAddressDecoder().decode(randomBytes(32)),
          seat,
          getAddressDecoder().decode(randomBytes(32)),
        ],
      );
    }
  }
  await pool.query(
    "update registrations set updated_at='2001-01-01' where id=$1",
    [paid.id],
  );
  const clock = vi.spyOn(chain, 'chainTime').mockResolvedValue(f.n + 801);
  const rpc = vi
    .spyOn(chain, 'depositSnapshot')
    .mockImplementation(async (_event, _policy, commitment) => ({
      ...snapshot,
      deposit: commitment === paid.deposit_address ? snapshot.deposit : null,
    }));
  try {
    await scheduleDue();
    await scheduleDue();
    const jobs = (
      await pool.query(
        "select registration_id,kind from outbox where kind in ('settle','timeout','no_show')",
      )
    ).rows;
    expect(jobs).toEqual([{ registration_id: paid.id, kind: 'timeout' }]);
    expect(rpc).toHaveBeenCalledTimes(200);
    const released = (
      await pool.query(
        "select count(*)::int as n from registrations where seat_state='Released' and updated_at='2000-01-01'",
      )
    ).rows[0];
    expect(released.n).toBe(100);
  } finally {
    clock.mockRestore();
    rpc.mockRestore();
  }
}, 60000);
