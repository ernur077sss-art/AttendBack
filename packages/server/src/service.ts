import { randomUUID, randomBytes } from 'node:crypto';
import { pool, transaction, type DbClient } from '../../db/src/index';
import {
  DomainError,
  sessionInput,
  utcNow,
  type Role,
} from '../../domain/src/index';
import { requireRole, sha256 } from './auth';
export async function enqueue(
  db: DbClient,
  kind: string,
  registrationId: string | null,
  dedup: string,
  payload: unknown = {},
) {
  await db.query(
    'insert into outbox(id,kind,registration_id,dedup_key,payload) values($1,$2,$3,$4,$5) on conflict(dedup_key) do nothing',
    [randomUUID(), kind, registrationId, dedup, JSON.stringify(payload)],
  );
}
export async function createOrganization(wallet: string, name: string) {
  return transaction(async (db) => {
    const id = randomUUID();
    await db.query('insert into organizations(id,name) values($1,$2)', [
      id,
      name,
    ]);
    await db.query(
      "insert into memberships(org_id,wallet,role) values($1,$2,'owner')",
      [id, wallet],
    );
    return { id, name };
  });
}
export async function addMember(
  actor: string,
  orgId: string,
  wallet: string,
  role: Role,
) {
  await requireRole(orgId, actor, ['owner']);
  if (role === 'owner')
    throw new DomainError(
      'ROLE',
      'Передача владения требует отдельной процедуры',
      400,
    );
  await pool.query(
    "insert into memberships(org_id,wallet,role) values($1,$2,$3) on conflict(org_id,wallet) do update set role=excluded.role where memberships.role<>'owner'",
    [orgId, wallet, role],
  );
  return { wallet, role };
}
export async function createEvent(
  wallet: string,
  orgId: string,
  input: unknown,
) {
  const data = sessionInput.parse(input);
  await requireRole(orgId, wallet, ['owner', 'manager']);
  if (data.policy.bookingClose <= utcNow())
    throw new DomainError(
      'DEADLINE',
      'Срок регистрации должен быть в будущем',
      400,
    );
  return transaction(async (db) => {
    const id = randomUUID(),
      sessionId = randomUUID(),
      termsHash = sha256(JSON.stringify(data.policy));
    await db.query(
      'insert into events(id,org_id,title,description,location,cancel_deadline,authority) values($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        orgId,
        data.title,
        data.description,
        data.location,
        data.policy.disputeDeadline,
        wallet,
      ],
    );
    await db.query(
      'insert into sessions(id,event_id,title,capacity,policy,terms_hash) values($1,$2,$3,$4,$5,$6)',
      [
        sessionId,
        id,
        data.title,
        data.capacity,
        JSON.stringify(data.policy),
        termsHash,
      ],
    );
    return { id, sessionId, termsHash };
  });
}
export async function listEvents() {
  return (
    await pool.query(
      `select e.id,e.title,e.description,e.location,e.cancelled,o.name as organization,s.id as session_id,s.capacity,s.policy,s.terms_hash,s.policy_address,s.published,(select count(*)::int from registrations r where r.session_id=s.id and r.seat_state in ('Offered','Reserved','PaymentPending','Active')) as occupied from events e join organizations o on o.id=e.org_id join sessions s on s.event_id=e.id where s.published order by e.created_at desc`,
    )
  ).rows;
}
export async function eventDetail(id: string, wallet?: string) {
  const r = await pool.query(
    'select e.*,o.name as organization from events e join organizations o on o.id=e.org_id where e.id=$1',
    [id],
  );
  if (!r.rowCount)
    throw new DomainError('NOT_FOUND', 'Событие не найдено', 404);
  const sessions = (
    await pool.query('select * from sessions where event_id=$1', [id])
  ).rows;
  if (sessions.every((s) => !s.published)) {
    if (!wallet)
      throw new DomainError('NOT_FOUND', 'Событие не опубликовано', 404);
    await requireRole(r.rows[0].org_id, wallet, [
      'owner',
      'manager',
      'staff',
      'resolver',
    ]);
  }
  return { ...r.rows[0], sessions };
}
export async function reserve(wallet: string, sessionId: string) {
  return transaction(async (db) => {
    const r = await db.query(
      'select s.*,e.cancelled from sessions s join events e on e.id=s.event_id where s.id=$1 for update of s',
      [sessionId],
    );
    const s = r.rows[0];
    if (!s?.published || s.cancelled || s.policy.bookingClose <= utcNow())
      throw new DomainError('CLOSED', 'Регистрация недоступна');
    const prior = await db.query(
      'select * from registrations where session_id=$1 and wallet=$2',
      [sessionId, wallet],
    );
    if (prior.rowCount) return prior.rows[0];
    const count = await db.query(
      "select count(*)::int as n from registrations where session_id=$1 and seat_state in ('Offered','Reserved','PaymentPending','Active')",
      [sessionId],
    );
    const waiting = await db.query(
      "select 1 from registrations where session_id=$1 and seat_state='Waitlisted' limit 1",
      [sessionId],
    );
    const seat =
      count.rows[0].n < s.capacity && !waiting.rowCount
        ? 'Reserved'
        : 'Waitlisted';
    const result = await db.query(
      "insert into registrations(id,session_id,wallet,seat_state,reserved_until) values($1,$2,$3,$4,case when $4='Reserved' then now()+interval '10 minutes' else null end) returning *",
      [randomUUID(), sessionId, wallet, seat],
    );
    return result.rows[0];
  });
}
export async function registration(
  id: string,
  wallet: string,
  db: DbClient = pool,
) {
  const r = await db.query(
    'select r.*,s.policy,s.terms_hash,s.policy_address,s.event_id,s.title,s.capacity,e.org_id,e.authority,e.cancel_deadline,e.chain_address as event_address,e.cancelled,e.location from registrations r join sessions s on s.id=r.session_id join events e on e.id=s.event_id where r.id=$1',
    [id],
  );
  const item = r.rows[0];
  if (!item) throw new DomainError('NOT_FOUND', 'Регистрация не найдена', 404);
  if (item.wallet !== wallet)
    await requireRole(
      item.org_id,
      wallet,
      ['owner', 'manager', 'staff', 'resolver'],
      db,
    );
  return item;
}
export async function ownerRegistration(
  id: string,
  wallet: string,
  db: DbClient = pool,
) {
  const item = await registration(id, wallet, db);
  if (item.wallet !== wallet)
    throw new DomainError(
      'FORBIDDEN',
      'Операция доступна владельцу билета',
      403,
    );
  return item;
}
export async function releaseAndOffer(db: DbClient, id: string) {
  const result = await db.query(
    'select session_id from registrations where id=$1',
    [id],
  );
  if (!result.rowCount) return;
  const sessionId = result.rows[0].session_id;
  await db.query('select id from sessions where id=$1 for update', [sessionId]);
  await db.query(
    "update registrations set seat_state='Released',ticket_hash=null,revision=revision+1,updated_at=now() where id=$1",
    [id],
  );
  await offerNext(db, sessionId);
}
export async function offerNext(db: DbClient, sessionId: string) {
  const s = (
    await db.query(
      'select s.*,e.cancelled from sessions s join events e on e.id=s.event_id where s.id=$1 for update of s',
      [sessionId],
    )
  ).rows[0];
  if (!s || s.cancelled || s.policy.bookingClose <= utcNow()) return;
  const count = (
    await db.query(
      "select count(*)::int as n from registrations where session_id=$1 and seat_state in ('Offered','Reserved','PaymentPending','Active')",
      [sessionId],
    )
  ).rows[0].n;
  for (let i = count; i < s.capacity; i++) {
    const r = await db.query(
      "select id,wallet from registrations where session_id=$1 and seat_state='Waitlisted' order by created_at,id limit 1 for update",
      [sessionId],
    );
    if (!r.rowCount) break;
    await db.query(
      "update registrations set seat_state='Offered',reserved_until=now()+interval '10 minutes',revision=revision+1 where id=$1",
      [r.rows[0].id],
    );
    await enqueue(db, 'notify', r.rows[0].id, `offer:${r.rows[0].id}`, {
      wallet: r.rows[0].wallet,
      message: 'Появилось место. Подтвердите бронь в течение 10 минут.',
    });
  }
}
export async function ticket(id: string, wallet: string) {
  return transaction(async (db) => {
    const r = await ownerRegistration(id, wallet, db);
    if (r.seat_state !== 'Active' || !r.deposit_address || !r.chain_slot)
      throw new DomainError('NOT_ACTIVE', 'Дождитесь подтверждения залога');
    const secret = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 120_000);
    await db.query(
      'update registrations set ticket_hash=$1,ticket_expires=$2 where id=$3',
      [sha256(secret), expiresAt, id],
    );
    return { token: `${id}.${secret}`, expiresAt: expiresAt.toISOString() };
  });
}
export async function leaveReservation(id: string, wallet: string) {
  return transaction(async (db) => {
    const r = await ownerRegistration(id, wallet, db);
    await db.query('select id from sessions where id=$1 for update', [
      r.session_id,
    ]);
    const fresh = (
      await db.query('select * from registrations where id=$1 for update', [id])
    ).rows[0];
    if (
      !['Waitlisted', 'Offered', 'Reserved'].includes(fresh.seat_state) ||
      fresh.permit_expires ||
      fresh.deposit_address
    )
      throw new DomainError(
        'PAYMENT_CHECK',
        'Сначала завершите проверку залога. Выданное разрешение нельзя отменить таймером.',
      );
    await releaseAndOffer(db, id);
    return { released: true };
  });
}
export async function evidenceList(actor: string, id: string) {
  const r = await registration(id, actor);
  if (r.wallet !== actor) {
    await requireRole(r.org_id, actor, ['owner', 'resolver']);
    if (r.policy.resolver !== actor)
      throw new DomainError('FORBIDDEN', 'Назначен другой арбитр', 403);
  }
  return (
    await pool.query(
      'select id,media_type,size,expires_at from evidence where registration_id=$1 and expires_at>now()',
      [id],
    )
  ).rows;
}
export async function checkin(actor: string, eventId: string, token: string) {
  const [id, secret, ...extra] = token.split('.');
  if (!id || !secret || extra.length || !/^[0-9a-f-]{36}$/.test(id))
    throw new DomainError('INVALID_QR', 'Неверный QR', 400);
  return transaction(async (db) => {
    const r = await registration(id, actor, db);
    await requireRole(r.org_id, actor, ['owner', 'manager', 'staff'], db);
    if (r.event_id !== eventId)
      throw new DomainError(
        'WRONG_EVENT',
        'Этот билет относится к другому событию',
        403,
      );
    await db.query('select id from registrations where id=$1 for update', [id]);
    const fresh = (
      await db.query('select * from registrations where id=$1', [id])
    ).rows[0];
    if (
      fresh.seat_state !== 'Active' ||
      fresh.late_cancel ||
      r.cancelled ||
      fresh.ticket_hash !== sha256(secret) ||
      new Date(fresh.ticket_expires).getTime() <= Date.now()
    )
      throw new DomainError('INVALID_QR', 'Билет истёк или неактивен');
    if (utcNow() < r.policy.checkinOpen || utcNow() >= r.policy.checkinClose)
      throw new DomainError('CHECKIN_WINDOW', 'Приём гостей сейчас закрыт');
    const exists = await db.query(
      'select * from checkins where registration_id=$1',
      [id],
    );
    if (exists.rowCount)
      return {
        registrationId: id,
        duplicate: true,
        eligibleAt: exists.rows[0].eligible_at,
      };
    const inserted = await db.query(
      "insert into checkins(registration_id,actor,eligible_at) values($1,$2,now()+interval '30 seconds') returning eligible_at",
      [id, actor],
    );
    await enqueue(db, 'attest', id, `attest:${id}:1`, { revision: 1 });
    return {
      registrationId: id,
      duplicate: false,
      eligibleAt: inserted.rows[0].eligible_at,
    };
  });
}
export async function correctCheckin(actor: string, id: string) {
  return transaction(async (db) => {
    const r = await registration(id, actor, db);
    await requireRole(r.org_id, actor, ['owner', 'manager', 'staff'], db);
    const c = (
      await db.query(
        'select * from checkins where registration_id=$1 for update',
        [id],
      )
    ).rows[0];
    if (!c || c.frozen || new Date(c.eligible_at).getTime() <= Date.now())
      throw new DomainError('FINAL_CHECKIN', 'Исправление уже недоступно');
    await db.query(
      'update checkins set corrected=true,revision=revision+1 where registration_id=$1',
      [id],
    );
    return { corrected: true };
  });
}
export async function saveDispute(
  wallet: string,
  id: string,
  description: string,
) {
  const r = await ownerRegistration(id, wallet);
  if (utcNow() < r.policy.checkinClose || utcNow() >= r.policy.disputeDeadline)
    throw new DomainError('DISPUTE_WINDOW', 'Срок открытия спора недоступен');
  await pool.query(
    'insert into disputes(registration_id,description) values($1,$2) on conflict(registration_id) do update set description=excluded.description where disputes.decision is null',
    [id, description],
  );
  return { registrationId: id };
}
export async function saveEvidence(
  wallet: string,
  id: string,
  mediaType: string,
  content: Buffer,
) {
  return transaction(async (db) => {
    const r = await ownerRegistration(id, wallet, db);
    const dispute = await db.query(
      'select registration_id from disputes where registration_id=$1 for update',
      [id],
    );
    if (!dispute.rowCount)
      throw new DomainError('NO_DISPUTE', 'Сначала создайте обращение');
    const valid =
      mediaType === 'text/plain' ||
      (mediaType === 'image/png' &&
        content
          .subarray(0, 8)
          .equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (mediaType === 'image/jpeg' &&
        content[0] === 255 &&
        content[1] === 216 &&
        content[2] === 255) ||
      (mediaType === 'application/pdf' &&
        content.subarray(0, 5).toString() === '%PDF-');
    if (!valid || !content.length || content.length > 2097152)
      throw new DomainError(
        'FILE',
        'Допустимы TXT, PNG, JPEG и PDF до 2 MiB',
        400,
      );
    const count = await db.query(
      'select count(*)::int as n from evidence where registration_id=$1',
      [id],
    );
    if (count.rows[0].n >= 5)
      throw new DomainError('FILE_LIMIT', 'Не более 5 материалов');
    const evidenceId = randomUUID();
    await db.query(
      "insert into evidence(id,registration_id,uploader,media_type,size,content,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '30 days')",
      [evidenceId, id, wallet, mediaType, content.length, content],
    );
    return { id: evidenceId };
  });
}
export async function readEvidence(actor: string, evidenceId: string) {
  const e = (
    await pool.query(
      'select * from evidence where id=$1 and expires_at>now()',
      [evidenceId],
    )
  ).rows[0];
  if (!e) throw new DomainError('NOT_FOUND', 'Материал недоступен', 404);
  const r = await registration(e.registration_id, actor);
  if (r.wallet !== actor) {
    await requireRole(r.org_id, actor, ['owner', 'resolver']);
    if (r.policy.resolver !== actor)
      throw new DomainError('FORBIDDEN', 'Назначен другой арбитр', 403);
  }
  return e;
}
export async function dashboard(wallet: string) {
  return {
    organizations: (
      await pool.query(
        'select o.*,m.role from organizations o join memberships m on m.org_id=o.id where m.wallet=$1',
        [wallet],
      )
    ).rows,
    events: (
      await pool.query(
        'select e.*,s.id as session_id,s.policy,s.published from events e join sessions s on s.event_id=e.id join memberships m on m.org_id=e.org_id where m.wallet=$1 order by e.created_at desc',
        [wallet],
      )
    ).rows,
    registrations: (
      await pool.query(
        'select r.*,s.title,s.policy,e.location from registrations r join sessions s on s.id=r.session_id join events e on e.id=s.event_id where r.wallet=$1 order by r.created_at desc',
        [wallet],
      )
    ).rows,
    notifications: (
      await pool.query(
        'select id,message,created_at from notifications where wallet=$1 order by created_at desc limit 30',
        [wallet],
      )
    ).rows,
  };
}

export async function addSession(
  wallet: string,
  eventId: string,
  input: unknown,
) {
  const data = sessionInput.parse(input);
  const event = (
    await pool.query('select * from events where id=$1', [eventId])
  ).rows[0];
  if (!event) throw new DomainError('NOT_FOUND', 'Событие не найдено', 404);
  await requireRole(event.org_id, wallet, ['owner', 'manager']);
  if (
    event.cancelled ||
    data.policy.bookingClose <= utcNow() ||
    data.policy.disputeDeadline < Number(event.cancel_deadline)
  )
    throw new DomainError('POLICY', 'Неподходящие сроки сессии', 400);
  const id = randomUUID();
  await pool.query(
    'insert into sessions(id,event_id,title,capacity,policy,terms_hash) values($1,$2,$3,$4,$5,$6)',
    [
      id,
      eventId,
      data.title,
      data.capacity,
      JSON.stringify(data.policy),
      sha256(JSON.stringify(data.policy)),
    ],
  );
  return { id };
}
export async function eventRegistrations(actor: string, eventId: string) {
  const e = (
    await pool.query('select org_id from events where id=$1', [eventId])
  ).rows[0];
  if (!e) throw new DomainError('NOT_FOUND', 'Событие не найдено', 404);
  const role = await requireRole(e.org_id, actor, [
    'owner',
    'manager',
    'staff',
    'resolver',
  ]);
  return (
    await pool.query(
      `select r.id,r.wallet,r.seat_state,r.deposit_state,r.late_cancel,r.created_at,s.title,s.policy,d.description as dispute_description,d.decision,c.frozen as checkin_frozen,c.corrected as checkin_corrected from registrations r join sessions s on s.id=r.session_id left join disputes d on d.registration_id=r.id left join checkins c on c.registration_id=r.id where s.event_id=$1 and ($2<>'resolver' or s.policy->>'resolver'=$3) order by r.created_at`,
      [eventId, role, actor],
    )
  ).rows.map((r) =>
    role === 'staff' ? { ...r, dispute_description: undefined } : r,
  );
}

export async function failedJobs(wallet: string) {
  const jobs = (
    await pool.query(
      `select j.id,j.kind,j.status,j.error_code,j.attempts,j.updated_at from outbox j join registrations r on r.id=j.registration_id join sessions s on s.id=r.session_id join events e on e.id=s.event_id join memberships m on m.org_id=e.org_id where m.wallet=$1 and m.role in ('owner','manager') and j.status<>'done' order by j.created_at limit 200`,
      [wallet],
    )
  ).rows;
  const sync = (
    await pool.query(
      `select r.id,'sync' as kind,'failed' as status,r.sync_error as error_code,0 as attempts,r.updated_at from registrations r join sessions s on s.id=r.session_id join events e on e.id=s.event_id join memberships m on m.org_id=e.org_id where m.wallet=$1 and m.role in ('owner','manager') and r.sync_error is not null limit 100`,
      [wallet],
    )
  ).rows;
  return [...jobs, ...sync];
}
export async function retryJob(actor: string, id: string) {
  const row = (
    await pool.query(
      'select e.org_id from outbox j join registrations r on r.id=j.registration_id join sessions s on s.id=r.session_id join events e on e.id=s.event_id where j.id=$1',
      [id],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Задание не найдено', 404);
  await requireRole(row.org_id, actor, ['owner', 'manager']);
  await pool.query(
    "update outbox set status=case when wire_transaction is null then 'ready' else 'submitted' end,available_at=now(),lease_until=null,error_code=null,attempts=0 where id=$1 and status='failed'",
    [id],
  );
  return { queued: true };
}
