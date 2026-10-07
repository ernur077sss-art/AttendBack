import { randomUUID } from 'node:crypto';
import { address, getSignatureFromTransaction } from '@solana/kit';
import { pool, transaction } from '../../db/src/index';
import { DomainError } from '../../domain/src/index';
import {
  getAttestPresentInstruction,
  getProposeNoShowInstruction,
} from '../../chain-client/src/index';
import { settlementInstructions } from './chain-service';
import {
  loadRegistration,
  syncDeposit,
  reconcileIntents,
  expireReservations,
  scheduleDue,
} from './sync';
import * as chain from './chain';
export async function claimJob(workerId: string) {
  return transaction(async (db) => {
    const r = await db.query(
      `select * from outbox where available_at<=now() and (status='ready' or status in ('leased','submitted') and (lease_until is null or lease_until<now())) order by available_at,created_at limit 1 for update skip locked`,
    );
    if (!r.rowCount) return null;
    const job = r.rows[0];
    return (
      await db.query(
        "update outbox set status=case when wire_transaction is null then 'leased' else 'submitted' end,lease_owner=$1,lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() where id=$2 returning *",
        [workerId, job.id],
      )
    ).rows[0];
  });
}
async function finish(
  job: Record<string, any>,
  status = 'done',
  error: string | null = null,
) {
  await pool.query(
    'update outbox set status=$1,error_code=$2,lease_until=null,updated_at=now() where id=$3 and lease_owner=$4',
    [status, error, job.id, job.lease_owner],
  );
}
async function retry(job: Record<string, any>, error: string | null = null) {
  await pool.query(
    "update outbox set status=case when wire_transaction is null then 'ready' else 'submitted' end,error_code=$1,available_at=now()+interval '2 seconds',lease_until=null,updated_at=now() where id=$2 and lease_owner=$3",
    [error, job.id, job.lease_owner],
  );
}
function achieved(kind: string, state: string) {
  return kind === 'attest'
    ? ['Refundable', 'Settled'].includes(state)
    : kind === 'no_show'
      ? [
          'NoShowProposed',
          'Disputed',
          'Refundable',
          'Forfeitable',
          'Settled',
        ].includes(state)
      : state === 'Settled';
}
export async function processJob(
  job: Record<string, any>,
  options: { afterPersist?: () => Promise<void> } = {},
) {
  try {
    if (job.kind === 'notify') {
      await transaction(async (db) => {
        const held = await db.query(
          'select id from outbox where id=$1 and lease_owner=$2 and lease_until>now() for update',
          [job.id, job.lease_owner],
        );
        if (!held.rowCount) return;
        await db.query(
          'insert into notifications(id,wallet,operation_id,message) values($1,$2,$3,$4) on conflict(operation_id,wallet) do nothing',
          [randomUUID(), job.payload.wallet, job.id, job.payload.message],
        );
        await db.query(
          "update outbox set status='done',lease_until=null where id=$1",
          [job.id],
        );
      });
      return;
    }
    await syncDeposit(job.registration_id);
    let r = await loadRegistration(job.registration_id);
    if (achieved(job.kind, r.deposit_state)) {
      await finish(job);
      return;
    }
    if (job.wire_transaction) {
      const status = await chain.signatureStatus(job.signature);
      if (status?.confirmationStatus === 'finalized' && !status.err) {
        await finish(job);
        await syncDeposit(job.registration_id);
        return;
      }
      if (status?.confirmationStatus === 'finalized' && status.err) {
        await finish(job, 'failed', 'CHAIN_REJECTED');
        return;
      }
      const epoch = await chain
        .rpc()
        .getEpochInfo({ commitment: 'finalized' })
        .send({ abortSignal: AbortSignal.timeout(12000) });
      if (!status && epoch.blockHeight > BigInt(job.last_valid_block_height)) {
        await syncDeposit(job.registration_id);
        r = await loadRegistration(job.registration_id);
        if (achieved(job.kind, r.deposit_state)) {
          await finish(job);
          return;
        }
        await pool.query(
          "update outbox set wire_transaction=null,signature=null,last_valid_block_height=null,status='ready',lease_until=null where id=$1 and lease_owner=$2",
          [job.id, job.lease_owner],
        );
        return;
      }
      await chain.broadcast(job.wire_transaction);
      await retry(job);
      return;
    }
    if (job.kind === 'attest') {
      const ready = await transaction(async (db) => {
        const c = (
          await db.query(
            'select * from checkins where registration_id=$1 for update',
            [r.id],
          )
        ).rows[0];
        if (!c || c.corrected || c.revision !== job.payload.revision)
          return 'obsolete';
        if (new Date(c.eligible_at).getTime() > Date.now()) return 'wait';
        await db.query(
          'update checkins set frozen=true where registration_id=$1',
          [r.id],
        );
        return 'ready';
      });
      if (ready === 'obsolete') {
        await finish(job);
        return;
      }
      if (ready === 'wait') {
        await retry(job);
        return;
      }
    }
    const payer = await chain.serviceSigner('payer');
    const base = {
      event: address(r.event_address),
      policy: address(r.policy_address),
      commitment: address(r.deposit_address),
    };
    let instructions;
    if (job.kind === 'attest' || job.kind === 'no_show') {
      const attester = await chain.serviceSigner('attester');
      if (attester.address !== r.policy.attester)
        throw new DomainError(
          'ATTESTER',
          'Configured attester differs from policy',
          503,
        );
      instructions = [
        job.kind === 'attest'
          ? getAttestPresentInstruction({ ...base, attester })
          : getProposeNoShowInstruction({ ...base, attester }),
      ];
    } else if (job.kind === 'settle' || job.kind === 'timeout')
      instructions = await settlementInstructions(
        payer,
        r,
        job.kind === 'timeout',
      );
    else throw new DomainError('JOB_KIND', 'Unknown job');
    const prepared = await chain.prepare(payer, instructions, 1);
    const signature = getSignatureFromTransaction(prepared.transaction);
    const saved = await pool.query(
      "update outbox set wire_transaction=$1,signature=$2,last_valid_block_height=$3,status='submitted',updated_at=now() where id=$4 and lease_owner=$5 and lease_until>now() returning id",
      [
        prepared.wire,
        signature,
        prepared.lastValidBlockHeight,
        job.id,
        job.lease_owner,
      ],
    );
    if (!saved.rowCount) return;
    if (options.afterPersist) await options.afterPersist();
    await chain.broadcast(prepared.wire);
    await retry(job);
  } catch (error) {
    if (error instanceof Error && error.message === 'SIMULATED_CRASH')
      throw error;
    const code = error instanceof DomainError ? error.code : 'RPC_RETRY';
    if (job.attempts >= 8 && !job.wire_transaction)
      await finish(job, 'failed', code);
    else await retry(job, code);
  }
}
export async function tick(workerId: string = randomUUID(), maxJobs = 10) {
  await pool.query('delete from evidence where expires_at<=now()');
  await pool.query('delete from auth_sessions where expires_at<=now()');
  await pool.query(
    "delete from auth_challenges where expires_at<now()-interval '1 day'",
  );
  await reconcileIntents();
  await expireReservations();
  await scheduleDue();
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimJob(workerId);
    if (!job) break;
    await processJob(job);
  }
  return { workerId, ok: true };
}
