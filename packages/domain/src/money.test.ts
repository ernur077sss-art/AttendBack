import { expect, test } from 'vitest';
import {
  policySchema,
  settlement,
  splitPrincipal,
  type Policy,
  type DepositState,
} from './index';
const w = '11111111111111111111111111111111';
const p: Policy = {
  amount: '101',
  penaltyBps: 5000,
  mint: w,
  bookingAuthority: w,
  attester: w,
  resolver: w,
  penaltyRecipient: w,
  bookingClose: 100,
  freeCancelUntil: 70,
  checkinOpen: 80,
  checkinClose: 100,
  proposalCutoff: 110,
  disputeDeadline: 120,
  resolutionDeadline: 130,
  hardRefundAt: 140,
};
test('integer accounting conserves principal including max u64 and extreme penalties', () => {
  for (const amount of [1n, 101n, 1000000n, (1n << 64n) - 1n])
    for (let bps = 0; bps <= 10000; bps += 37) {
      const s = splitPrincipal(amount, bps);
      expect(s.refund + s.penalty).toBe(amount);
      expect(s.penalty).toBeLessThanOrEqual(amount);
    }
  expect(splitPrincipal(101n, 5000)).toEqual({ refund: 51n, penalty: 50n });
  expect(splitPrincipal(1n, 10000).refund).toBe(0n);
});
test('dispute blocks penalties, hard timeout and cancellation override every unsettled state', () => {
  const states: DepositState[] = [
    'Funded',
    'Refundable',
    'NoShowProposed',
    'Disputed',
    'Forfeitable',
  ];
  for (const s of states) {
    expect(settlement(p, s, 140, false)).toEqual({ refund: 101n, penalty: 0n });
    expect(settlement(p, s, 101, true).refund).toBe(101n);
  }
  expect(() => settlement(p, 'Disputed', 139, false)).toThrow('NOT_SETTLEABLE');
  expect(() => settlement(p, 'Settled', 140, true)).toThrow('ALREADY_SETTLED');
});
test('penalty boundary is inclusive; earlier requests fail', () => {
  expect(() => settlement(p, 'NoShowProposed', 119, false)).toThrow();
  expect(settlement(p, 'NoShowProposed', 120, false).penalty).toBe(50n);
});
test('invalid temporal policies and unsafe amounts are rejected', () => {
  expect(policySchema.safeParse(p).success).toBe(true);
  for (const v of [
    { hardRefundAt: 130 },
    { proposalCutoff: 120 },
    { freeCancelUntil: 90 },
    { amount: '1.5' },
    { penaltyBps: 10001 },
  ])
    expect(policySchema.safeParse({ ...p, ...v }).success).toBe(false);
});
