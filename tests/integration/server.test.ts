import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { getAddressDecoder } from '@solana/kit';
import { pool, transaction } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import {
  challenge,
  verifyChallenge,
  authenticatedWallet,
  cookie,
  requireRole,
} from '../../packages/server/src/auth';
import {
  createOrganization,
  createEvent,
  reserve,
  releaseAndOffer,
  addMember,
  ticket,
  checkin,
  correctCheckin,
  saveDispute,
  saveEvidence,
  readEvidence,
  leaveReservation,
  eventRegistrations,
  eventDetail,
  addSession,
  eventCheckinHistory,
} from '../../packages/server/src/service';
import { chainTime } from '../../packages/server/src/chain';
import { handle } from '../../packages/server/src/http';
const key = () => {
  const p = generateKeyPairSync('ed25519');
  return {
    wallet: getAddressDecoder().decode(
      p.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    ),
    privateKey: p.privateKey,
  };
};
const owner = key(),
  guest = key(),
  staff = key(),
  resolver = key(),
  stranger = key();
async function setup(capacity = 1) {
  const org = await createOrganization(
    owner.wallet,
    'Integration organization',
  );
  await addMember(owner.wallet, org.id, staff.wallet, 'staff');
  await addMember(owner.wallet, org.id, resolver.wallet, 'resolver');
  const networkNow = await chainTime();
  const p = {
    amount: '1000000',
    penaltyBps: 5000,
    mint: key().wallet,
    bookingAuthority: key().wallet,
    attester: key().wallet,
    resolver: resolver.wallet,
    penaltyRecipient: owner.wallet,
    bookingClose: networkNow + 600,
    freeCancelUntil: networkNow - 100,
    checkinOpen: networkNow - 10,
    checkinClose: networkNow + 700,
    proposalCutoff: networkNow + 800,
    disputeDeadline: networkNow + 900,
    resolutionDeadline: networkNow + 1000,
    hardRefundAt: networkNow + 1100,
  };
  const event = await createEvent(owner.wallet, org.id, {
    title: 'Integration event',
    description: 'Test only',
    location: 'Localhost',
    capacity,
    policy: p,
  });
  await pool.query(
    'update sessions set published=true,policy_address=$1 where id=$2',
    [key().wallet, event.sessionId],
  );
  return { org, event, p };
}
beforeAll(async () => {
  const db = (await pool.query('select current_database() as name')).rows[0]
    .name;
  expect(db.endsWith('_test')).toBe(true);
  await migrate();
  await pool.query(
    'truncate organizations,auth_challenges,auth_sessions,rate_limits cascade',
  );
});
afterAll(() => pool.end());
test('signed nonce establishes session once; wrong signature and reuse fail', async () => {
  const c = await challenge(guest.wallet);
  await expect(
    verifyChallenge(
      c.id,
      sign(null, Buffer.from(c.message), stranger.privateKey).toString(
        'base64',
      ),
    ),
  ).rejects.toThrow();
  const signature = sign(
    null,
    Buffer.from(c.message),
    guest.privateKey,
  ).toString('base64');
  const results = await Promise.allSettled([
    verifyChallenge(c.id, signature),
    verifyChallenge(c.id, signature),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const ok = results.find((x) => x.status === 'fulfilled');
  if (ok?.status !== 'fulfilled') throw new Error('No session');
  expect(
    await authenticatedWallet(
      new Request('http://127.0.0.1:3000/api/me', {
        headers: { cookie: cookie(ok.value.token) },
      }),
    ),
  ).toBe(guest.wallet);
});
test('60 concurrent requests allocate one last seat and preserve FIFO waitlist', async () => {
  const { event } = await setup();
  const results = await Promise.all(
    Array.from({ length: 60 }, () => reserve(key().wallet, event.sessionId)),
  );
  expect(results.filter((r) => r.seat_state === 'Reserved')).toHaveLength(1);
  expect(results.filter((r) => r.seat_state === 'Waitlisted')).toHaveLength(59);
  const earliest = (
    await pool.query(
      "select id from registrations where session_id=$1 and seat_state='Waitlisted' order by created_at,id limit 1",
      [event.sessionId],
    )
  ).rows[0].id;
  await transaction((db) =>
    releaseAndOffer(db, results.find((r) => r.seat_state === 'Reserved').id),
  );
  const offered = (
    await pool.query(
      "select id from registrations where session_id=$1 and seat_state='Offered'",
      [event.sessionId],
    )
  ).rows;
  expect(offered).toEqual([{ id: earliest }]);
});
test('same guest concurrently receives one registration; PaymentPending continues to occupy capacity', async () => {
  const { event } = await setup();
  const [a, b] = await Promise.all([
    reserve(guest.wallet, event.sessionId),
    reserve(guest.wallet, event.sessionId),
  ]);
  expect(a.id).toBe(b.id);
  await pool.query(
    "update registrations set seat_state='PaymentPending',reserved_until=now()-interval '1 day' where id=$1",
    [a.id],
  );
  expect((await reserve(stranger.wallet, event.sessionId)).seat_state).toBe(
    'Waitlisted',
  );
});
test('tenant role checks and published policy immutability are enforced', async () => {
  const { org, event } = await setup();
  await expect(
    requireRole(org.id, stranger.wallet, ['owner']),
  ).rejects.toThrow();
  await expect(
    addMember(staff.wallet, org.id, stranger.wallet, 'manager'),
  ).rejects.toThrow();
  await expect(
    pool.query(
      'update sessions set policy=policy || \'{"amount":"1"}\'::jsonb where id=$1',
      [event.sessionId],
    ),
  ).rejects.toThrow('immutable');
});
test('QR needs active finalized projection; wrong event and foreign staff fail; duplicate queues one attestation', async () => {
  const { event } = await setup();
  const r = await reserve(guest.wallet, event.sessionId);
  await expect(ticket(r.id, guest.wallet)).rejects.toThrow();
  await pool.query(
    "update registrations set seat_state='Active',deposit_address=$1,chain_slot=10 where id=$2",
    [key().wallet, r.id],
  );
  const t = await ticket(r.id, guest.wallet);
  await expect(checkin(stranger.wallet, event.id, t.token)).rejects.toThrow();
  await expect(checkin(staff.wallet, randomUUID(), t.token)).rejects.toThrow();
  const first = await checkin(staff.wallet, event.id, t.token),
    second = await checkin(staff.wallet, event.id, t.token);
  expect(first.duplicate).toBe(false);
  expect(second.duplicate).toBe(true);
  expect(
    Number(
      (
        await pool.query(
          "select count(*) as n from outbox where registration_id=$1 and kind='attest'",
          [r.id],
        )
      ).rows[0].n,
    ),
  ).toBe(1);
  await correctCheckin(staff.wallet, r.id);
  await correctCheckin(staff.wallet, r.id);
  const rescanned = await checkin(staff.wallet, event.id, t.token);
  expect(rescanned.duplicate).toBe(false);
  expect(
    (
      await pool.query(
        'select corrected,revision from checkins where registration_id=$1',
        [r.id],
      )
    ).rows[0],
  ).toEqual({ corrected: false, revision: 3 });
  const history = await eventCheckinHistory(owner.wallet, event.id);
  expect(history.map((row) => [row.action, row.revision, row.actor])).toEqual([
    ['checkin.confirmed', '3', staff.wallet],
    ['checkin.corrected', '2', staff.wallet],
    ['checkin.confirmed', '1', staff.wallet],
  ]);
  await expect(
    eventCheckinHistory(stranger.wallet, event.id),
  ).rejects.toThrow();
  await expect(
    eventCheckinHistory(resolver.wallet, event.id),
  ).rejects.toThrow();
  await pool.query('update checkins set frozen=true where registration_id=$1', [
    r.id,
  ]);
  await expect(correctCheckin(staff.wallet, r.id)).rejects.toThrow();
});
test('leaving an unpaid reservation offers the next guest, but never releases an issued payment permit', async () => {
  const { event } = await setup(1);
  const r = await reserve(guest.wallet, event.sessionId),
    next = await reserve(stranger.wallet, event.sessionId);
  await expect(leaveReservation(r.id, stranger.wallet)).rejects.toThrow();
  await leaveReservation(r.id, guest.wallet);
  expect(
    (
      await pool.query('select seat_state from registrations where id=$1', [
        next.id,
      ])
    ).rows[0].seat_state,
  ).toBe('Offered');
  await pool.query(
    'update registrations set permit_expires=9999999999 where id=$1',
    [next.id],
  );
  await expect(leaveReservation(next.id, stranger.wallet)).rejects.toThrow();
  expect(
    (
      await pool.query('select seat_state from registrations where id=$1', [
        next.id,
      ])
    ).rows[0].seat_state,
  ).toBe('Offered');
});
test('evidence is private even when its UUID is known', async () => {
  const { event } = await setup();
  const r = await reserve(guest.wallet, event.sessionId);
  await pool.query(
    'insert into disputes(registration_id,description) values($1,$2)',
    [r.id, 'Present at this event, please review'],
  );
  const e = await saveEvidence(
    guest.wallet,
    r.id,
    'text/plain',
    Buffer.from('Private evidence'),
  );
  expect((await readEvidence(resolver.wallet, e.id)).content.toString()).toBe(
    'Private evidence',
  );
  await expect(readEvidence(stranger.wallet, e.id)).rejects.toThrow();
  await expect(readEvidence(staff.wallet, e.id)).rejects.toThrow();
  expect(
    (await eventRegistrations(owner.wallet, event.id))[0].dispute_description,
  ).toBeUndefined();
  expect(
    (await eventRegistrations(resolver.wallet, event.id))[0]
      .dispute_description,
  ).toBe('Present at this event, please review');
  await expect(
    saveEvidence(guest.wallet, r.id, 'image/png', Buffer.from('not PNG')),
  ).rejects.toThrow();
  await pool.query(
    "update disputes set decision='refund' where registration_id=$1",
    [r.id],
  );
  await expect(
    saveEvidence(
      guest.wallet,
      r.id,
      'text/plain',
      Buffer.from('Late evidence'),
    ),
  ).rejects.toThrow('закрытого');
});
test('public event details never expose unpublished sessions', async () => {
  const { event, p } = await setup();
  await addSession(owner.wallet, event.id, {
    title: 'Private draft',
    description: 'Draft',
    location: 'Localhost',
    capacity: 5,
    policy: p,
  });
  expect((await eventDetail(event.id)).sessions).toHaveLength(1);
  expect((await eventDetail(event.id, owner.wallet)).sessions).toHaveLength(2);
});
test('HTTP protects mutation origin, returns validation errors and never accepts client paid=true', async () => {
  const cross = await handle(
    new Request('http://127.0.0.1:3000/api/auth/challenge', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ wallet: guest.wallet }),
    }),
  );
  expect(cross.status).toBe(403);
  const bad = await handle(
    new Request('http://127.0.0.1:3000/api/auth/challenge', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000' },
      body: JSON.stringify({ wallet: 'invalid' }),
    }),
  );
  expect(bad.status).toBe(400);
  const unauth = await handle(new Request('http://127.0.0.1:3000/api/me'));
  expect(unauth.status).toBe(401);
});
