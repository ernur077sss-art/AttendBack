import { pool } from '../../db/src/index';

// Wake at domain deadlines; idle applications must let Neon scale to zero.
// Chain time still decides eligibility inside tick(), never this wall clock.
export async function nextReconciliationAt() {
  const result = await pool.query<{ next_at: Date | null }>(`
    select min(at) as next_at from (
      select greatest(available_at, coalesce(lease_until, now())) as at
      from outbox where status in ('ready','leased','submitted')
      union all
      select now() + interval '15 seconds' from transaction_intents
      where status in ('prepared','submitted')
      union all
      select greatest(reserved_until, now() + interval '30 seconds')
      from registrations where seat_state in ('Reserved','Offered','PaymentPending')
      union all
      select now() + interval '60 seconds' from registrations r
      where r.sync_error is not null or (r.deposit_state='Settled'
        and not exists(select 1 from ledger l where l.registration_id=r.id))
      union all
      select now() + interval '15 seconds'
      from registrations r join sessions s on s.id=r.session_id
      join events e on e.id=s.event_id
      left join checkins c on c.registration_id=r.id
      cross join lateral (
        select case
          when (s.policy->>'hardRefundAt')::double precision <= extract(epoch from now()) then 'timeout'
          when e.cancelled or r.deposit_state='Refundable' or
            (r.deposit_state in ('NoShowProposed','Forfeitable') and
             (s.policy->>'disputeDeadline')::double precision <= extract(epoch from now())) then 'settle'
          when r.deposit_state='Funded' and
            (s.policy->>'checkinClose')::double precision <= extract(epoch from now()) and
            (s.policy->>'proposalCutoff')::double precision > extract(epoch from now()) and
            (c.registration_id is null or c.corrected) then 'no_show'
        end as kind
      ) action
      where r.deposit_state is not null and r.deposit_state<>'Settled'
        and action.kind is not null
        and not exists(select 1 from outbox o where o.dedup_key=action.kind || ':' || r.id::text)
      union all
      select to_timestamp((s.policy->>deadline.name)::double precision) + interval '5 seconds'
      from registrations r join sessions s on s.id=r.session_id
      cross join (values ('checkinClose'),('proposalCutoff'),('disputeDeadline'),
        ('resolutionDeadline'),('hardRefundAt')) as deadline(name)
      where r.deposit_state is not null and r.deposit_state<>'Settled'
        and to_timestamp((s.policy->>deadline.name)::double precision) + interval '5 seconds' > now()
      union all
      select now() + interval '15 minutes'
      from registrations r join sessions s on s.id=r.session_id
      where r.deposit_state is not null and r.deposit_state<>'Settled'
        and to_timestamp((s.policy->>'hardRefundAt')::double precision) <= now()
    ) pending
  `);
  const due = result.rows[0]?.next_at;
  // No active work: one housekeeping wake per day, with no running process.
  return new Date(
    due
      ? Math.max(Date.now() + 15_000, due.getTime())
      : Date.now() + 86_400_000,
  );
}
