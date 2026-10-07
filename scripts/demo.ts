import {
  signTransaction,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import {
  localSigner,
  chainTime,
  signatureStatus,
  network,
} from '../packages/server/src/chain';
import {
  publicConfig,
  preparePublication,
  submitIntent,
} from '../packages/server/src/chain-service';
import {
  createOrganization,
  addMember,
  createEvent,
} from '../packages/server/src/service';
import { reconcileIntents } from '../packages/server/src/sync';
import { pool } from '../packages/db/src';
import type { Policy } from '../packages/domain/src';
export async function sendLocal(
  signer: KeyPairSigner,
  intent: Awaited<ReturnType<typeof preparePublication>>,
) {
  if (network().cluster !== 'localnet')
    throw new Error('Synthetic demo is localnet only');
  const signed = await signTransaction(
    [signer.keyPair],
    getTransactionDecoder().decode(Buffer.from(intent.transaction, 'base64')),
  );
  const sent = await submitIntent(
    signer.address,
    intent.id,
    getBase64EncodedWireTransaction(signed),
  );
  for (let i = 0; i < 100; i++) {
    const s = await signatureStatus(sent.signature);
    if (s?.err) throw new Error('Demo transaction failed');
    if (s?.confirmationStatus === 'finalized') {
      await reconcileIntents();
      return sent;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Demo finality timeout');
}
export async function seedDemo(
  title = 'Builders Meetup · Astana (демо)',
  mode: 'attendance' | 'cancel' = 'attendance',
  capacity = 30,
  overrides: Partial<Policy> = {},
) {
  const owner = await localSigner('owner'),
    staff = await localSigner('staff'),
    resolver = await localSigner('resolver'),
    cfg = await publicConfig(),
    n = await chainTime();
  const org = await createOrganization(owner.address, 'AttendBack Demo');
  await addMember(owner.address, org.id, staff.address, 'staff');
  await addMember(owner.address, org.id, resolver.address, 'resolver');
  const event = await createEvent(owner.address, org.id, {
    title,
    description:
      'Демонстрационное событие для проверки бронирования, входа и возврата. Тестовые токены без денежной стоимости. Площадка не является партнёром проекта.',
    location: 'Астана · демонстрационная площадка',
    capacity,
    policy: {
      amount: '5000000',
      penaltyBps: 5000,
      mint: cfg.mint,
      bookingAuthority: cfg.bookingAuthority,
      attester: cfg.attester,
      resolver: resolver.address,
      penaltyRecipient: owner.address,
      bookingClose: n + 7200,
      freeCancelUntil: mode === 'cancel' ? n + 3600 : n - 120,
      checkinOpen: mode === 'cancel' ? n + 3700 : n - 60,
      checkinClose: n + 10800,
      proposalCutoff: n + 14400,
      disputeDeadline: n + 86400,
      resolutionDeadline: n + 172800,
      hardRefundAt: n + 259200,
      ...overrides,
    },
  });
  await sendLocal(
    owner,
    await preparePublication(owner.address, event.sessionId, 1),
  );
  return event;
}
if (process.argv[1]?.endsWith('/demo.ts'))
  seedDemo()
    .then((e) =>
      console.log(`Demo event: http://127.0.0.1:3000/events/${e.id}`),
    )
    .finally(() => pool.end());
