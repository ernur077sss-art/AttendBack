import { expect, test } from 'vitest';
import { generateKeyPairSigner, lamports, none } from '@solana/kit';
import {
  AccountState,
  getTokenEncoder,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { fixture } from './fixture';
import {
  DepositStatus,
  getProposeNoShowInstruction,
  getOpenDisputeInstruction,
  getResolveDisputeInstruction,
  getSettleInstruction,
  getTimeoutRefundInstruction,
  getAttestPresentInstruction,
  getCancelEventInstruction,
  getCancelRegistrationInstruction,
} from './index';

test('stage 4: no-show settlement respects the deadline, split and principal conservation', async () => {
  for (const bps of [0, 5000, 10000]) {
    const f = await fixture({ penaltyBps: bps });
    await f.deposit();
    f.time(1399);
    await expect(
      f.send(getProposeNoShowInstruction(f.attendInput)),
    ).rejects.toThrow();
    f.time(1400);
    await f.send(getProposeNoShowInstruction(f.attendInput));
    f.time(1599);
    await expect(f.send(getSettleInstruction(f.settleInput))).rejects.toThrow();
    f.time(1600);
    await f.send(getSettleInstruction(f.settleInput));
    const { refund, penalty } = f.state();
    expect(refund + penalty).toBe(10_000_001n);
    expect(penalty).toBe((10_000_001n * BigInt(bps)) / 10000n);
    expect(f.balance(f.penaltyTokens)).toBe(penalty);
    expect(f.balance(f.vault)).toBe(0n);
  }
});
test('stage 4: disputes block settlement and both fixed resolutions work', async () => {
  for (const refund of [true, false]) {
    const f = await fixture();
    await f.deposit();
    f.time(1400);
    await f.send(getOpenDisputeInstruction(f.actionInput));
    await expect(
      f.send(getOpenDisputeInstruction(f.actionInput)),
    ).rejects.toThrow();
    await expect(
      f.send(getAttestPresentInstruction(f.attendInput)),
    ).rejects.toThrow();
    const other = await generateKeyPairSigner();
    await expect(
      f.send(
        getResolveDisputeInstruction({
          resolver: other,
          policy: f.policy,
          event: f.event,
          commitment: f.commitment,
          refund,
        }),
      ),
    ).rejects.toThrow();
    f.time(1600);
    await expect(f.send(getSettleInstruction(f.settleInput))).rejects.toThrow();
    await f.send(
      getResolveDisputeInstruction({
        resolver: f.resolver,
        policy: f.policy,
        event: f.event,
        commitment: f.commitment,
        refund,
      }),
    );
    await f.send(getSettleInstruction(f.settleInput));
    expect(f.state().penalty).toBe(refund ? 0n : 5_000_000n);
  }
});
test('stage 4: hard timeout overrides a dispute and even an awarded penalty', async () => {
  for (const resolved of [false, true]) {
    const f = await fixture();
    await f.deposit();
    f.time(1400);
    await f.send(getProposeNoShowInstruction(f.attendInput));
    await f.send(getOpenDisputeInstruction(f.actionInput));
    if (resolved)
      await f.send(
        getResolveDisputeInstruction({
          resolver: f.resolver,
          policy: f.policy,
          event: f.event,
          commitment: f.commitment,
          refund: false,
        }),
      );
    f.time(1800);
    await f.send(getTimeoutRefundInstruction(f.settleInput));
    expect(f.state().refund).toBe(10_000_001n);
    expect(f.state().penalty).toBe(0n);
  }
});
test('stage 4: proposal, dispute, resolution and event cancellation reject their exclusive upper boundaries', async () => {
  const f = await fixture();
  await f.deposit();
  f.time(1500);
  await expect(
    f.send(getProposeNoShowInstruction(f.attendInput)),
  ).rejects.toThrow();
  f.time(1600);
  await expect(
    f.send(getOpenDisputeInstruction(f.actionInput)),
  ).rejects.toThrow();
  await expect(
    f.send(
      getCancelEventInstruction({ authority: f.authority, event: f.event }),
    ),
  ).rejects.toThrow();
  const d = await fixture();
  await d.deposit();
  d.time(1400);
  await d.send(getOpenDisputeInstruction(d.actionInput));
  d.time(1700);
  await expect(
    d.send(
      getResolveDisputeInstruction({
        resolver: d.resolver,
        policy: d.policy,
        event: d.event,
        commitment: d.commitment,
        refund: false,
      }),
    ),
  ).rejects.toThrow();
});
test('stage 4: cancelling event overrides no-show and disputed states', async () => {
  for (const dispute of [false, true]) {
    const f = await fixture();
    await f.deposit();
    f.time(1400);
    await f.send(getProposeNoShowInstruction(f.attendInput));
    if (dispute) await f.send(getOpenDisputeInstruction(f.actionInput));
    await f.send(
      getCancelEventInstruction({ authority: f.authority, event: f.event }),
    );
    await f.send(getSettleInstruction(f.settleInput));
    expect(f.state().refund).toBe(10_000_001n);
  }
});
test('stage 4: second SPL transfer failure rolls back the first transfer and status', async () => {
  const f = await fixture();
  await f.deposit();
  f.time(1400);
  await f.send(getProposeNoShowInstruction(f.attendInput));
  f.time(1600);
  const data = getTokenEncoder().encode({
    mint: f.mint,
    owner: f.beneficiary.address,
    amount: 0n,
    delegate: none(),
    state: AccountState.Frozen,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
  });
  f.svm.setAccount({
    address: f.penaltyTokens,
    data,
    space: BigInt(data.length),
    executable: false,
    programAddress: TOKEN_PROGRAM_ADDRESS,
    lamports: lamports(
      f.svm.minimumBalanceForRentExemption(BigInt(data.length)),
    ),
  });
  const before = f.balance(f.guestTokens);
  await expect(f.send(getSettleInstruction(f.settleInput))).rejects.toThrow();
  expect(f.balance(f.guestTokens)).toBe(before);
  expect(f.balance(f.vault)).toBe(10_000_001n);
  expect(f.state().status).toBe(DepositStatus.NoShowProposed);
  f.seedToken(f.penaltyTokens, f.beneficiary.address, 0n);
  await f.send(getSettleInstruction(f.settleInput));
  expect(f.state().status).toBe(DepositStatus.Settled);
});
test('stage 4: late cancellation remains subject to the agreed no-show rule', async () => {
  const f = await fixture();
  await f.deposit();
  f.time(1150);
  await f.send(getCancelRegistrationInstruction(f.actionInput));
  f.time(1400);
  await f.send(getProposeNoShowInstruction(f.attendInput));
  f.time(1600);
  await f.send(getSettleInstruction(f.settleInput));
  expect(f.state().penalty).toBe(5_000_000n);
});
