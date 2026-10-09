import { beforeAll, afterAll, expect, test } from 'vitest';
import {
  signTransaction,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  type KeyPairSigner,
  address,
} from '@solana/kit';
import { pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import {
  createOrganization,
  createEvent,
  reserve,
} from '../../packages/server/src/service';
import {
  localSigner,
  signatureStatus,
  depositSnapshot,
} from '../../packages/server/src/chain';
import {
  publicConfig,
  preparePublication,
  submitIntent,
  syncPublication,
  prepareDeposit,
} from '../../packages/server/src/chain-service';
import {
  commitmentPda,
  DepositStatus,
} from '../../packages/chain-client/src/index';
beforeAll(async () => {
  expect(
    (
      await pool.query('select current_database() as name')
    ).rows[0].name.endsWith('_test'),
  ).toBe(true);
  await migrate();
});
afterAll(() => pool.end());
async function send(
  signer: KeyPairSigner,
  intent: Awaited<ReturnType<typeof preparePublication>>,
) {
  const tx = getTransactionDecoder().decode(
    Buffer.from(intent.transaction, 'base64'),
  );
  const signed = await signTransaction([signer.keyPair], tx);
  const result = await submitIntent(
    signer.address,
    intent.id,
    getBase64EncodedWireTransaction(signed),
  );
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const status = await signatureStatus(result.signature);
    if (status?.err) throw new Error(JSON.stringify(status.err));
    if (status?.confirmationStatus === 'finalized') return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Finality timeout');
}
test('stage 5: server prepares co-signed deposit, guest signs and the actual RPC reports finalized funds', async () => {
  const owner = await localSigner('owner'),
    guest = await localSigner('guest');
  const cfg = await publicConfig(),
    n = Math.floor(Date.now() / 1000);
  const org = await createOrganization(owner.address, 'RPC integration');
  const event = await createEvent(owner.address, org.id, {
    title: 'RPC integration event',
    description: 'Local Solana test',
    location: 'Test environment',
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
      freeCancelUntil: n + 100,
      checkinOpen: n + 200,
      checkinClose: n + 400,
      proposalCutoff: n + 500,
      disputeDeadline: n + 600,
      resolutionDeadline: n + 700,
      hardRefundAt: n + 800,
    },
  });
  const publication = await preparePublication(
    owner.address,
    event.sessionId,
    1,
  );
  expect(publication.simulation.ok).toBe(true);
  await send(owner, publication);
  expect((await syncPublication(event.sessionId)).published).toBe(true);
  await expect(reserve(owner.address, event.sessionId)).rejects.toMatchObject({
    code: 'PENALTY_RECIPIENT',
    status: 400,
  });
  expect(
    (
      await pool.query(
        'select count(*)::int as count from registrations where session_id=$1',
        [event.sessionId],
      )
    ).rows[0].count,
  ).toBe(0);
  const r = await reserve(guest.address, event.sessionId);
  const permit = await prepareDeposit(guest.address, r.id, 0);
  expect(permit.simulation.ok).toBe(true);
  await expect(
    submitIntent(owner.address, permit.id, publication.transaction),
  ).rejects.toThrow();
  await send(guest, permit);
  const row = (
    await pool.query(
      'select r.*,s.policy_address,e.chain_address from registrations r join sessions s on s.id=r.session_id join events e on e.id=s.event_id where r.id=$1',
      [r.id],
    )
  ).rows[0];
  expect(row.seat_state).toBe('PaymentPending');
  const chain = await depositSnapshot(
    address(row.chain_address),
    address(row.policy_address),
    await commitmentPda(address(row.policy_address), guest.address),
  );
  expect(chain.deposit?.status).toBe(DepositStatus.Funded);
  expect(chain.deposit?.principal).toBe(1000000n);
}, 60000);
