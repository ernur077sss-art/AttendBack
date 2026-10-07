import { randomUUID } from 'node:crypto';
import {
  address,
  createNoopSigner,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { pool, transaction, type DbClient } from '../../db/src/index';
import { DomainError, policySchema, utcNow } from '../../domain/src/index';
import * as program from '../../chain-client/src/index';
import { requireRole } from './auth';
import { ownerRegistration, registration } from './service';
import * as chain from './chain';
const tokenAddress = async (owner: Address, mint: Address) =>
  (
    await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];
export async function publicConfig() {
  const [booking, attester] = await Promise.all([
    chain.serviceSigner('booking'),
    chain.serviceSigner('attester'),
  ]);
  return {
    cluster: chain.network().cluster,
    program: program.PROGRAM_ADDRESS,
    bookingAuthority: booking.address,
    attester: attester.address,
    mint:
      chain.network().cluster === 'localnet'
        ? (await chain.localSigner('mint')).address
        : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  };
}
export function assertPolicy(
  row: Record<string, any>,
  snapshot: Awaited<ReturnType<typeof chain.policySnapshot>>,
) {
  const p = policySchema.parse(row.policy);
  const actual = snapshot.policy,
    e = snapshot.event;
  if (
    !actual ||
    !e ||
    e.authority !== row.authority ||
    actual.event !== row.event_address ||
    actual.mint !== p.mint ||
    !Buffer.from(actual.id).equals(
      Buffer.from(program.idBytes(row.session_id)),
    ) ||
    !Buffer.from(actual.terms.termsHash).equals(
      Buffer.from(row.terms_hash, 'hex'),
    )
  )
    throw new DomainError(
      'POLICY_MISMATCH',
      'Политика не подтверждена в сети',
      409,
    );
  const numeric = [
    'amount',
    'penaltyBps',
    'bookingClose',
    'freeCancelUntil',
    'checkinOpen',
    'checkinClose',
    'proposalCutoff',
    'disputeDeadline',
    'resolutionDeadline',
    'hardRefundAt',
  ] as const;
  for (const key of numeric)
    if (BigInt(actual.terms[key]) !== BigInt(p[key]))
      throw new DomainError(
        'POLICY_MISMATCH',
        'Условия отличаются от on-chain политики',
        409,
      );
  for (const key of [
    'bookingAuthority',
    'attester',
    'resolver',
    'penaltyRecipient',
  ] as const)
    if (actual.terms[key] !== p[key])
      throw new DomainError(
        'POLICY_MISMATCH',
        'Роли отличаются от on-chain политики',
        409,
      );
  return actual;
}
async function sessionRow(id: string, db: DbClient = pool) {
  const s = (
    await db.query(
      'select s.*,s.id as session_id,e.id as event_id,e.org_id,e.authority,e.chain_address as event_address,e.cancel_deadline,e.cancelled from sessions s join events e on e.id=s.event_id where s.id=$1',
      [id],
    )
  ).rows[0];
  if (!s) throw new DomainError('NOT_FOUND', 'Сессия не найдена', 404);
  return s;
}
async function saveIntent(
  db: DbClient,
  wallet: string,
  kind: string,
  row: Record<string, any>,
  prepared: Awaited<ReturnType<typeof chain.prepare>>,
  registrationId: string | null = null,
  permitExpires: number | null = null,
) {
  const id = randomUUID();
  await db.query(
    'insert into transaction_intents(id,wallet,kind,registration_id,session_id,event_id,wire_transaction,last_valid_block_height,permit_expires) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      id,
      wallet,
      kind,
      registrationId,
      row.session_id,
      row.event_id,
      prepared.wire,
      prepared.lastValidBlockHeight,
      permitExpires,
    ],
  );
  return {
    id,
    transaction: prepared.wire,
    simulation: prepared.simulation,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
    summary: {
      action: kind,
      cluster: chain.network().cluster,
      program: program.PROGRAM_ADDRESS,
      mint: row.policy.mint,
      principal: row.policy.amount,
      guest: wallet,
      penaltyRecipient: row.policy.penaltyRecipient,
      penaltyBps: row.policy.penaltyBps,
      feePayer: wallet,
      fees: 'Комиссия сети и хранение аккаунтов оплачиваются отдельно от залога',
    },
  };
}
export async function preparePublication(
  wallet: string,
  sessionId: string,
  version: 0 | 1,
) {
  return transaction(async (db) => {
    await db.query('select id from sessions where id=$1 for update', [
      sessionId,
    ]);
    const s = await sessionRow(sessionId, db);
    await requireRole(s.org_id, wallet, ['owner', 'manager'], db);
    if (s.authority !== wallet)
      throw new DomainError(
        'AUTHORITY',
        'Публикацию подписывает создатель события',
        403,
      );
    const cfg = await publicConfig();
    const p = policySchema.parse(s.policy);
    if (
      p.mint !== cfg.mint ||
      p.bookingAuthority !== cfg.bookingAuthority ||
      p.attester !== cfg.attester
    )
      throw new DomainError(
        'SERVICE_POLICY',
        'Используйте mint и служебные роли из конфигурации',
        400,
      );
    const owner = createNoopSigner(address(wallet)),
      event = await program.eventPda(
        owner.address,
        program.idBytes(s.event_id),
      ),
      policy = await program.policyPda(event, program.idBytes(sessionId));
    const snap = await chain.policySnapshot(event, policy);
    if (snap.policy)
      throw new DomainError(
        'ALREADY_PUBLISHED',
        'Политика уже есть в сети; обновите состояние',
      );
    const ixs: Instruction[] = [];
    if (!snap.event)
      ixs.push(
        program.getCreateEventInstruction({
          authority: owner,
          event,
          id: program.idBytes(s.event_id),
          cancelDeadline: BigInt(s.cancel_deadline),
        }),
      );
    else if (snap.event.authority !== owner.address)
      throw new DomainError('AUTHORITY', 'Неверный владелец события', 403);
    ixs.push(
      program.getPublishPolicyInstruction({
        authority: owner,
        event,
        policy,
        mint: address(p.mint),
        id: program.idBytes(sessionId),
        terms: {
          ...p,
          amount: BigInt(p.amount),
          bookingAuthority: address(p.bookingAuthority),
          attester: address(p.attester),
          resolver: address(p.resolver),
          penaltyRecipient: address(p.penaltyRecipient),
          termsHash: Buffer.from(s.terms_hash, 'hex'),
        },
      }),
    );
    const prepared = await chain.prepare(owner, ixs, version);
    await db.query('update events set chain_address=$1 where id=$2', [
      event,
      s.event_id,
    ]);
    await db.query('update sessions set policy_address=$1 where id=$2', [
      policy,
      sessionId,
    ]);
    return saveIntent(db, wallet, 'publish', s, prepared);
  });
}
export async function syncPublication(sessionId: string) {
  const s = await sessionRow(sessionId);
  if (!s.event_address || !s.policy_address) return { published: false };
  const snap = await chain.policySnapshot(
    address(s.event_address),
    address(s.policy_address),
  );
  if (!snap.policy) return { published: false };
  assertPolicy(s, snap);
  await pool.query('update sessions set published=true where id=$1', [
    sessionId,
  ]);
  await pool.query('update events set cancelled=cancelled OR $1 where id=$2', [
    snap.event!.cancelled,
    s.event_id,
  ]);
  return { published: true };
}
export async function prepareDeposit(
  wallet: string,
  id: string,
  version: 0 | 1,
) {
  return transaction(async (db) => {
    const before = await ownerRegistration(id, wallet, db);
    await db.query('select id from sessions where id=$1 for update', [
      before.session_id,
    ]);
    await db.query('select id from registrations where id=$1 for update', [id]);
    const r = await ownerRegistration(id, wallet, db),
      s = await sessionRow(r.session_id, db);
    if (
      !['Reserved', 'Offered', 'PaymentPending'].includes(r.seat_state) ||
      !s.published
    )
      throw new DomainError('NO_RESERVATION', 'Нет активного резерва места');
    if (
      r.seat_state !== 'PaymentPending' &&
      new Date(r.reserved_until).getTime() <= Date.now()
    )
      throw new DomainError('RESERVATION_EXPIRED', 'Срок резерва истёк');
    const snap = await chain.policySnapshot(
      address(s.event_address),
      address(s.policy_address),
    );
    assertPolicy(s, snap);
    if (snap.event?.cancelled)
      throw new DomainError('CANCELLED', 'Событие отменено');
    const guest = createNoopSigner(address(wallet)),
      booking = await chain.serviceSigner('booking');
    if (booking.address !== s.policy.bookingAuthority)
      throw new DomainError('SIGNER', 'Booking authority недоступен', 503);
    const commitment = await program.commitmentPda(
        address(s.policy_address),
        guest.address,
      ),
      vault = await program.vaultPda(commitment);
    const permitExpires = Math.min(
      (await chain.chainTime()) + 300,
      s.policy.bookingClose,
    );
    const instruction = program.getDepositInstruction({
      guest,
      bookingAuthority: booking,
      event: address(s.event_address),
      policy: address(s.policy_address),
      commitment,
      vault,
      source: await tokenAddress(guest.address, address(s.policy.mint)),
      mint: address(s.policy.mint),
      permitExpires,
    });
    const prepared = await chain.prepare(guest, [instruction], version);
    await db.query(
      "update registrations set seat_state='PaymentPending',deposit_address=$1,permit_expires=greatest(coalesce(permit_expires,0),$2),permit_last_valid_block_height=greatest(coalesce(permit_last_valid_block_height,0),$3),revision=revision+1 where id=$4",
      [commitment, permitExpires, prepared.lastValidBlockHeight, id],
    );
    return saveIntent(db, wallet, 'deposit', s, prepared, id, permitExpires);
  });
}
export type DepositAction =
  | 'cancel'
  | 'settle'
  | 'timeout'
  | 'dispute'
  | 'resolve_refund'
  | 'resolve_forfeit';
export async function settlementInstructions(
  payer:
    | ReturnType<typeof createNoopSigner>
    | Awaited<ReturnType<typeof chain.serviceSigner>>,
  r: Record<string, any>,
  timeout = false,
) {
  const mint = address(r.policy.mint),
    guestTokens = await tokenAddress(address(r.wallet), mint),
    penaltyTokens = await tokenAddress(
      address(r.policy.penaltyRecipient),
      mint,
    );
  const accounts = {
    event: address(r.event_address),
    policy: address(r.policy_address),
    commitment: address(r.deposit_address),
    vault: await program.vaultPda(address(r.deposit_address)),
    guestTokens,
    penaltyTokens,
    mint,
  };
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: guestTokens,
      owner: address(r.wallet),
      mint,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: penaltyTokens,
      owner: address(r.policy.penaltyRecipient),
      mint,
    }),
    timeout
      ? program.getTimeoutRefundInstruction(accounts)
      : program.getSettleInstruction(accounts),
  ];
}
export async function prepareAction(
  wallet: string,
  id: string,
  action: DepositAction,
  version: 0 | 1,
) {
  const r = await registration(id, wallet);
  if (!r.deposit_address || !r.event_address || !r.policy_address)
    throw new DomainError('NO_DEPOSIT', 'Залог не найден');
  const actor = createNoopSigner(address(wallet));
  const base = {
    event: address(r.event_address),
    policy: address(r.policy_address),
    commitment: address(r.deposit_address),
  };
  let ixs: Instruction[];
  if (action.startsWith('resolve_')) {
    await requireRole(r.org_id, wallet, ['owner', 'resolver']);
    if (r.policy.resolver !== wallet)
      throw new DomainError('RESOLVER', 'Назначен другой арбитр', 403);
    ixs = [
      program.getResolveDisputeInstruction({
        ...base,
        resolver: actor,
        refund: action === 'resolve_refund',
      }),
    ];
  } else {
    if (r.wallet !== wallet)
      throw new DomainError(
        'FORBIDDEN',
        'Используйте собственную регистрацию',
        403,
      );
    if (action === 'cancel')
      ixs = [
        program.getCancelRegistrationInstruction({ ...base, guest: actor }),
      ];
    else if (action === 'dispute')
      ixs = [program.getOpenDisputeInstruction({ ...base, guest: actor })];
    else ixs = await settlementInstructions(actor, r, action === 'timeout');
  }
  const prepared = await chain.prepare(actor, ixs, version);
  return saveIntent(pool, wallet, action, r, prepared, id);
}
export async function prepareEventCancel(
  wallet: string,
  eventId: string,
  version: 0 | 1,
) {
  const e = (await pool.query('select * from events where id=$1', [eventId]))
    .rows[0];
  if (!e || e.authority !== wallet)
    throw new DomainError(
      'AUTHORITY',
      'Отмену подписывает создатель события',
      403,
    );
  await requireRole(e.org_id, wallet, ['owner', 'manager']);
  const s = (
    await pool.query(
      'select id from sessions where event_id=$1 order by created_at limit 1',
      [eventId],
    )
  ).rows[0];
  const row = await sessionRow(s.id);
  const actor = createNoopSigner(address(wallet));
  const prepared = await chain.prepare(
    actor,
    [
      program.getCancelEventInstruction({
        authority: actor,
        event: address(e.chain_address),
      }),
    ],
    version,
  );
  return saveIntent(pool, wallet, 'cancel_event', row, prepared);
}
export async function submitIntent(
  wallet: string,
  id: string,
  signedWire: string,
) {
  const r = await transaction(async (db) => {
    const intent = (
      await db.query(
        'select * from transaction_intents where id=$1 for update',
        [id],
      )
    ).rows[0];
    if (!intent || intent.wallet !== wallet)
      throw new DomainError('NOT_FOUND', 'Операция не найдена', 404);
    if (['failed', 'expired'].includes(intent.status))
      throw new DomainError('EXPIRED', 'Подготовьте новую операцию');
    const sig = chain.verifySignedWire(intent.wire_transaction, signedWire);
    await db.query(
      "update transaction_intents set wire_transaction=$1,signature=$2,status=case when status='finalized' then status else 'submitted' end where id=$3",
      [signedWire, sig, id],
    );
    return { ...intent, wire_transaction: signedWire, signature: sig };
  });
  if (r.status !== 'finalized') {
    try {
      await chain.broadcast(r.wire_transaction);
    } catch {
      return {
        id,
        signature: r.signature,
        status: 'submitted',
        message: 'Отправка требует повторной проверки сети',
      };
    }
  }
  return {
    id,
    signature: r.signature,
    status: r.status === 'finalized' ? 'finalized' : 'submitted',
  };
}
export async function intentStatus(wallet: string, id: string) {
  const r = (
    await pool.query(
      'select id,kind,signature,status,error_code from transaction_intents where id=$1 and wallet=$2',
      [id, wallet],
    )
  ).rows[0];
  if (!r) throw new DomainError('NOT_FOUND', 'Операция не найдена', 404);
  return r;
}
export async function fundLocalWallet(wallet: string) {
  if (chain.network().cluster !== 'localnet')
    throw new DomainError(
      'LOCAL_ONLY',
      'Тестовое пополнение доступно только локально',
      403,
    );
  const mint = (await chain.localSigner('mint')).address;
  await chain
    .rpc()
    .requestAirdrop(
      address(wallet),
      1_000_000_000n as import('@solana/kit').Lamports,
    )
    .send({ abortSignal: AbortSignal.timeout(12000) });
  const response = await fetch(chain.network().rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'surfnet_setTokenAccount',
      params: [wallet, mint, { amount: 1_000_000_000 }],
    }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (data.error)
    throw new DomainError(
      'FAUCET',
      'Не удалось пополнить тестовый баланс',
      503,
    );
  return {
    cluster: 'localnet',
    mint,
    amount: '1000000000',
    message: 'Тестовые токены не имеют денежной стоимости',
  };
}
