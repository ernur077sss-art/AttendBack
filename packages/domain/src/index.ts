import { z } from 'zod';
export const walletSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const amountSchema = z
  .string()
  .max(20)
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (v) => /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= (1n << 64n) - 1n,
    'Amount exceeds u64',
  );
export const policySchema = z
  .object({
    amount: amountSchema,
    penaltyBps: z.number().int().min(0).max(10_000),
    mint: walletSchema,
    bookingAuthority: walletSchema,
    attester: walletSchema,
    resolver: walletSchema,
    penaltyRecipient: walletSchema,
    bookingClose: z.number().int(),
    freeCancelUntil: z.number().int(),
    checkinOpen: z.number().int(),
    checkinClose: z.number().int(),
    proposalCutoff: z.number().int(),
    disputeDeadline: z.number().int(),
    resolutionDeadline: z.number().int(),
    hardRefundAt: z.number().int(),
  })
  .superRefine((p, ctx) => {
    if (
      !(
        p.freeCancelUntil <= p.checkinOpen &&
        p.checkinOpen < p.checkinClose &&
        p.bookingClose <= p.checkinClose &&
        p.checkinClose < p.proposalCutoff &&
        p.proposalCutoff < p.disputeDeadline &&
        p.disputeDeadline <= p.resolutionDeadline &&
        p.resolutionDeadline < p.hardRefundAt
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid policy time ordering' });
  });
export type Policy = z.infer<typeof policySchema>;
export type DepositState =
  | 'Funded'
  | 'Refundable'
  | 'NoShowProposed'
  | 'Disputed'
  | 'Forfeitable'
  | 'Settled';
export type SeatState =
  | 'Waitlisted'
  | 'Offered'
  | 'Reserved'
  | 'PaymentPending'
  | 'Active'
  | 'Released';
export type Role = 'owner' | 'manager' | 'staff' | 'resolver';
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function assertRule(
  condition: unknown,
  code: string,
  message = code,
): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
export function splitPrincipal(amount: bigint, bps: number) {
  assertRule(amount > 0n && amount <= (1n << 64n) - 1n, 'INVALID_AMOUNT');
  assertRule(Number.isInteger(bps) && bps >= 0 && bps <= 10_000, 'INVALID_BPS');
  const penalty = (amount * BigInt(bps)) / 10_000n;
  return { refund: amount - penalty, penalty };
}
export function settlement(
  p: Policy,
  state: DepositState,
  now: number,
  cancelled: boolean,
) {
  assertRule(state !== 'Settled', 'ALREADY_SETTLED');
  const amount = BigInt(p.amount);
  if (cancelled || now >= p.hardRefundAt || state === 'Refundable')
    return { refund: amount, penalty: 0n };
  assertRule(
    now >= p.disputeDeadline &&
      (state === 'Forfeitable' || state === 'NoShowProposed'),
    'NOT_SETTLEABLE',
  );
  return splitPrincipal(amount, p.penaltyBps);
}
export const sessionInput = z.object({
  title: z.string().min(3).max(140),
  description: z.string().max(4000),
  location: z.string().min(2).max(240),
  capacity: z.number().int().min(1).max(10000),
  policy: policySchema,
});
export const utcNow = () => Math.floor(Date.now() / 1000);
export function displayAmount(value: string | bigint, decimals = 6) {
  const n = BigInt(value);
  const factor = 10n ** BigInt(decimals);
  const fraction = (n % factor)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${n / factor}${fraction ? `.${fraction}` : ''}`;
}
