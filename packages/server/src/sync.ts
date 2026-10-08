import { randomUUID } from 'node:crypto';
import { address, getBase58Encoder } from '@solana/kit';
import { pool, transaction } from '../../db/src/index';
import { DomainError, displayAmount } from '../../domain/src/index';
import {
  DepositStatus,
  PROGRAM_ADDRESS,
  getSettleDiscriminatorBytes,
  getTimeoutRefundDiscriminatorBytes,
} from '../../chain-client/src/index';
import { registration, releaseAndOffer, enqueue } from './service';
import { assertPolicy, syncPublication } from './chain-service';
import * as chain from './chain';
export async function loadRegistration(id: string) {
  const r = (
    await pool.query('select wallet from registrations where id=$1', [id])
  ).rows[0];
  if (!r) throw new DomainError('NOT_FOUND', 'Registration missing', 404);
  return registration(id, r.wallet);
}
async function settlementReceipt(id: string, commitment: string) {
  const tracked = await pool.query(
    `select signature from transaction_intents where registration_id=$1 and status in ('submitted','finalized') and kind in ('settle','timeout') union select signature from outbox where registration_id=$1 and status='done' and kind in ('settle','timeout')`,
    [id],
  );
  for (const row of tracked.rows) {
    if (!row.signature) continue;
    const status = await chain.signatureStatus(row.signature);
    if (status?.confirmationStatus === 'finalized' && !status.err)
      return { signature: row.signature as string, slot: status.slot };
  }
  const signatures = await chain
    .rpc()
    .getSignaturesForAddress(address(commitment), {
      commitment: 'finalized',
      limit: 50,
    })
    .send({ abortSignal: AbortSignal.timeout(12000) });
  for (const s of signatures) {
    if (s.err) continue;
    const tx = await chain
      .rpc()
      .getTransaction(s.signature, {
        encoding: 'json',
        commitment: 'finalized',
        maxSupportedTransactionVersion: 1,
      })
      .send({ abortSignal: AbortSignal.timeout(12000) });
    if (!tx || tx.meta?.err) continue;
    const keys = [
      ...tx.transaction.message.accountKeys,
      ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? []),
    ];
    const ixs = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions?.flatMap((i) => i.instructions) ?? []),
    ];
    for (const ix of ixs) {
      if (
        keys[Number(ix.programIdIndex)] !== PROGRAM_ADDRESS ||
        ix.accounts.length < 8 ||
        keys[Number(ix.accounts[2])] !== commitment
      )
        continue;
      const data = Buffer.from(getBase58Encoder().encode(ix.data));
      if (
        [
          getSettleDiscriminatorBytes(),
          getTimeoutRefundDiscriminatorBytes(),
        ].some((d) => data.subarray(0, 8).equals(Buffer.from(d)))
      )
        return { signature: s.signature, slot: tx.slot };
    }
  }
  return null;
}
export async function syncDeposit(id: string) {
  const r = await loadRegistration(id);
  if (!r.event_address || !r.policy_address || !r.deposit_address)
    return { synced: false };
  const snapshot = await chain.depositSnapshot(
    address(r.event_address),
    address(r.policy_address),
    address(r.deposit_address),
  );
  assertPolicy(r, snapshot);
  const d = snapshot.deposit;
  if (!d) {
    // Rotate unpaid permits through the bounded reconciliation batch as well.
    await pool.query('update registrations set updated_at=now() where id=$1', [
      id,
    ]);
    return { synced: false };
  }
  if (
    d.guest !== r.wallet ||
    d.policy !== r.policy_address ||
    d.principal !== BigInt(r.policy.amount)
  )
    throw new DomainError(
      'DEPOSIT_MISMATCH',
      'Deposit does not match registration',
      503,
    );
  if (
    d.status === DepositStatus.Settled &&
    d.refund + d.penalty !== d.principal
  )
    throw new DomainError('ACCOUNTING', 'Invalid settlement accounting', 503);
  const state = DepositStatus[d.status];
  const settlement =
    d.status === DepositStatus.Settled
      ? await settlementReceipt(id, r.deposit_address)
      : null;
  await transaction(async (db) => {
    await db.query('select id from sessions where id=$1 for update', [
      r.session_id,
    ]);
    const current = (
      await db.query('select * from registrations where id=$1 for update', [id])
    ).rows[0];
    if (BigInt(current.chain_slot) > snapshot.slot) return;
    await db.query('update events set cancelled=cancelled OR $1 where id=$2', [
      snapshot.event!.cancelled,
      r.event_id,
    ]);
    await db.query(
      `update registrations set deposit_state=$1,late_cancel=$2,chain_slot=$3,revision=revision+1,sync_error=null,updated_at=now(),seat_state=case when seat_state in ('PaymentPending','Reserved','Offered') and $4 then 'Active' else seat_state end where id=$5`,
      [
        state,
        d.lateCancel,
        snapshot.slot.toString(),
        !d.guestCancelled && !snapshot.event!.cancelled,
        id,
      ],
    );
    if (
      (d.guestCancelled || snapshot.event!.cancelled) &&
      current.seat_state !== 'Released'
    )
      await releaseAndOffer(db, id);
    if (current.deposit_state !== state && state === 'NoShowProposed')
      await enqueue(db, 'notify', id, `no-show-notice:${id}`, {
        wallet: r.wallet,
        message: `Посещение не подтверждено. Можно открыть спор до ${new Date(r.policy.disputeDeadline * 1000).toISOString()}.`,
      });
    if (settlement) {
      const receipt = await db.query(
        'insert into ledger(id,registration_id,signature,slot,refund,penalty) values($1,$2,$3,$4,$5,$6) on conflict(registration_id) do nothing returning id',
        [
          randomUUID(),
          id,
          settlement.signature,
          settlement.slot.toString(),
          d.refund.toString(),
          d.penalty.toString(),
        ],
      );
      if (receipt.rowCount)
        await enqueue(
          db,
          'notify',
          id,
          `settlement-notice:${id}:${settlement.signature}`,
          {
            wallet: r.wallet,
            message: `Расчёт подтверждён: возвращено ${displayAmount(d.refund)} USDC, удержано ${displayAmount(d.penalty)} USDC.`,
          },
        );
    }
    if (
      d.status !== DepositStatus.Settled &&
      (d.status === DepositStatus.Refundable || snapshot.event!.cancelled)
    )
      await enqueue(db, 'settle', id, `settle:${id}`);
  });
  return { synced: true, state, slot: snapshot.slot.toString() };
}
export async function reconcileIntents() {
  const intents = (
    await pool.query(
      "select * from transaction_intents where status in ('prepared','submitted') order by created_at limit 100",
    )
  ).rows;
  for (const item of intents) {
    try {
      const status = item.signature
        ? await chain.signatureStatus(item.signature)
        : null;
      if (status?.confirmationStatus === 'finalized' && status.err) {
        await pool.query(
          "update transaction_intents set status='failed',error_code='CHAIN_REJECTED' where id=$1 and status<>'finalized'",
          [item.id],
        );
        continue;
      }
      if (status?.confirmationStatus === 'finalized') {
        // Project the decision before marking the intent complete, so a DB error is retried.
        if (
          item.registration_id &&
          ['resolve_refund', 'resolve_forfeit'].includes(item.kind)
        )
          await pool.query(
            'update disputes set decision=$1,resolver=$2 where registration_id=$3',
            [
              item.kind === 'resolve_refund' ? 'refund' : 'forfeit',
              item.wallet,
              item.registration_id,
            ],
          );
        if (item.kind === 'publish' || item.kind === 'cancel_event')
          await syncPublication(item.session_id);
        if (item.registration_id) await syncDeposit(item.registration_id);
        await pool.query(
          "update transaction_intents set status='finalized',error_code=null where id=$1",
          [item.id],
        );
        continue;
      }
      const height = await chain
        .rpc()
        .getBlockHeight({ commitment: 'finalized' })
        .send({ abortSignal: AbortSignal.timeout(12000) });
      if (!status && height > BigInt(item.last_valid_block_height))
        await pool.query(
          "update transaction_intents set status='expired',error_code='BLOCKHASH_EXPIRED' where id=$1 and status<>'finalized'",
          [item.id],
        );
      else if (item.signature) await chain.broadcast(item.wire_transaction);
    } catch {
      await pool.query(
        "update transaction_intents set error_code='RPC_RECHECK' where id=$1 and status<>'finalized'",
        [item.id],
      );
    }
  }
}
export async function expireReservations() {
  const candidates = (
    await pool.query(
      "select id from registrations where seat_state in ('Reserved','Offered','PaymentPending') and reserved_until<now() order by updated_at,id limit 50",
    )
  ).rows;
  for (const item of candidates) {
    try {
      let needsSync = false;
      await transaction(async (db) => {
        const before = await loadRegistration(item.id);
        await db.query('select id from sessions where id=$1 for update', [
          before.session_id,
        ]);
        const r = (
          await db.query('select * from registrations where id=$1 for update', [
            item.id,
          ])
        ).rows[0];
        if (
          !['Reserved', 'Offered', 'PaymentPending'].includes(r.seat_state) ||
          new Date(r.reserved_until).getTime() > Date.now()
        )
          return;
        if (r.permit_expires) {
          const now = await chain.chainTime();
          const epoch = await chain
            .rpc()
            .getEpochInfo({ commitment: 'finalized' })
            .send({ abortSignal: AbortSignal.timeout(12000) });
          if (
            now <= Number(r.permit_expires) ||
            epoch.blockHeight <= BigInt(r.permit_last_valid_block_height)
          )
            return;
          const snap = await chain.depositSnapshot(
            address(before.event_address),
            address(before.policy_address),
            address(r.deposit_address),
            epoch.absoluteSlot,
          );
          assertPolicy(before, snap);
          if (snap.deposit) {
            needsSync = true;
            return;
          }
        }
        await releaseAndOffer(db, item.id);
      });
      if (needsSync) await syncDeposit(item.id);
      await pool.query(
        'update registrations set sync_error=null,updated_at=now() where id=$1',
        [item.id],
      );
    } catch (error) {
      // Keep uncertain seats occupied, but let unrelated jobs and expirations run.
      await pool.query(
        'update registrations set sync_error=$1,updated_at=now() where id=$2',
        [error instanceof DomainError ? error.code : 'RPC_RECHECK', item.id],
      );
    }
  }
}
export async function scheduleDue() {
  const now = await chain.chainTime();
  const records = (
    await pool.query(
      "select r.id from registrations r where r.deposit_address is not null and (r.deposit_state is not null or r.seat_state='PaymentPending') and (r.deposit_state is null or r.deposit_state<>'Settled' or not exists(select 1 from ledger l where l.registration_id=r.id)) order by r.updated_at,r.id limit 100",
    )
  ).rows;
  for (const item of records) {
    try {
      await syncDeposit(item.id);
      const r = await loadRegistration(item.id);
      if (!r.deposit_state || r.deposit_state === 'Settled') continue;
      if (now >= r.policy.hardRefundAt) {
        await enqueue(pool, 'timeout', r.id, `timeout:${r.id}`);
        continue;
      }
      if (
        r.cancelled ||
        r.deposit_state === 'Refundable' ||
        (now >= r.policy.disputeDeadline &&
          ['NoShowProposed', 'Forfeitable'].includes(r.deposit_state))
      ) {
        await enqueue(pool, 'settle', r.id, `settle:${r.id}`);
        continue;
      }
      if (
        r.deposit_state === 'Funded' &&
        now >= r.policy.checkinClose &&
        now < r.policy.proposalCutoff
      ) {
        const checkin = (
          await pool.query(
            'select corrected from checkins where registration_id=$1',
            [r.id],
          )
        ).rows[0];
        if (!checkin || checkin.corrected)
          await enqueue(pool, 'no_show', r.id, `no_show:${r.id}`);
      }
    } catch (error) {
      await pool.query(
        'update registrations set sync_error=$1,updated_at=now() where id=$2',
        [error instanceof DomainError ? error.code : 'RPC_RECHECK', item.id],
      );
    }
  }
}
