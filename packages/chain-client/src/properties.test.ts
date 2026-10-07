import { test, expect } from 'vitest';
import { fixture } from './fixture';
import {
  getProposeNoShowInstruction,
  getOpenDisputeInstruction,
  getResolveDisputeInstruction,
  getCancelEventInstruction,
  getSettleInstruction,
  DepositStatus,
} from './index';
test('generated program sequences conserve actual SPL balances, make settlement one-shot, and preserve timeout priority', async () => {
  let seed = 0xc01055;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 24; i++) {
    const amount = BigInt((random() % 500000000) + 1),
      bps = random() % 10001,
      f = await fixture({ amount, penaltyBps: bps });
    const before = f.balance(f.guestTokens) + f.balance(f.penaltyTokens);
    await f.deposit();
    f.time(1400);
    await f.send(getProposeNoShowInstruction(f.attendInput));
    const scenario = i % 4;
    if (scenario <= 1) {
      await f.send(getOpenDisputeInstruction(f.actionInput));
      await expect(
        f.send(getSettleInstruction(f.settleInput)),
      ).rejects.toThrow();
      await f.send(
        getResolveDisputeInstruction({
          event: f.event,
          policy: f.policy,
          commitment: f.commitment,
          resolver: f.resolver,
          refund: scenario === 0,
        }),
      );
    }
    if (scenario === 2)
      await f.send(
        getCancelEventInstruction({ event: f.event, authority: f.authority }),
      );
    f.time(scenario === 3 ? 1800 : 1600);
    await f.send(getSettleInstruction(f.settleInput));
    const state = f.state();
    expect(state.status).toBe(DepositStatus.Settled);
    expect(state.refund + state.penalty).toBe(amount);
    expect(state.penalty).toBe(
      scenario === 1 ? (amount * BigInt(bps)) / 10000n : 0n,
    );
    expect(f.balance(f.guestTokens) + f.balance(f.penaltyTokens)).toBe(before);
    expect(f.balance(f.vault)).toBe(0n);
    await expect(f.send(getSettleInstruction(f.settleInput))).rejects.toThrow();
    expect(f.state()).toEqual(state);
  }
}, 30000);
