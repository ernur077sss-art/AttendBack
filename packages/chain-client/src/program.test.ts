import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createClient,
  generateKeyPairSigner,
  lamports,
  none,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { signer } from '@solana/kit-plugin-signer';
import { litesvm } from '@solana/kit-plugin-litesvm';
import { Clock } from 'litesvm';
import {
  AccountState,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenEncoder,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  PROGRAM_ADDRESS,
  idBytes,
  eventPda,
  policyPda,
  commitmentPda,
  vaultPda,
  getCreateEventInstruction,
  getPublishPolicyInstruction,
  getDepositInstruction,
  getAttestPresentInstruction,
  getCancelRegistrationInstruction,
  getCancelEventInstruction,
  getSettleInstruction,
  getTimeoutRefundInstruction,
  getCommitmentDecoder,
  DepositStatus,
  type TermsArgs,
} from './index';

import { fixture } from './fixture';

describe('stage 3: SBF program and actual SPL transfers', () => {
  test('attendance returns principal to fixed guest; repeat settlement and redeposit fail', async () => {
    const f = await fixture();
    await f.deposit();
    expect(f.balance(f.vault)).toBe(10_000_001n);
    f.time(1200);
    await f.send(getAttestPresentInstruction(f.attendInput));
    expect(f.state().status).toBe(DepositStatus.Refundable);
    await f.send(getSettleInstruction(f.settleInput));
    expect(f.balance(f.guestTokens)).toBe(1_000_000_000n);
    expect(f.balance(f.vault)).toBe(0n);
    expect(f.state().status).toBe(DepositStatus.Settled);
    await expect(f.send(getSettleInstruction(f.settleInput))).rejects.toThrow();
    await expect(f.deposit()).rejects.toThrow();
  });
  test('early cancellation grants full refund; late cancellation does not grant attendance', async () => {
    const early = await fixture();
    await early.deposit();
    await early.send(getCancelRegistrationInstruction(early.actionInput));
    await early.send(getSettleInstruction(early.settleInput));
    expect(early.state().refund).toBe(10_000_001n);
    const late = await fixture();
    await late.deposit();
    late.time(1150);
    await late.send(getCancelRegistrationInstruction(late.actionInput));
    expect(late.state().lateCancel).toBe(true);
    late.time(1200);
    await expect(
      late.send(getAttestPresentInstruction(late.attendInput)),
    ).rejects.toThrow();
    await expect(
      late.send(getSettleInstruction(late.settleInput)),
    ).rejects.toThrow();
  });
  test('event cancellation and hard timeout give permissionless full refunds', async () => {
    const f = await fixture();
    await f.deposit();
    await f.send(
      getCancelEventInstruction({ authority: f.authority, event: f.event }),
    );
    await f.send(getSettleInstruction(f.settleInput));
    expect(f.state().refund).toBe(10_000_001n);
    const t = await fixture();
    await t.deposit();
    t.time(1799);
    await expect(
      t.send(getTimeoutRefundInstruction(t.settleInput)),
    ).rejects.toThrow();
    t.time(1800);
    await t.send(getTimeoutRefundInstruction(t.settleInput));
    expect(t.balance(t.guestTokens)).toBe(1_000_000_000n);
  });
  test('wrong authority, expired permit, wrong recipient and wrong mint are rejected', async () => {
    const f = await fixture();
    const attacker = await generateKeyPairSigner();
    await expect(
      f.send(
        getDepositInstruction({
          ...f.depositInput,
          bookingAuthority: attacker,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      f.send(getDepositInstruction({ ...f.depositInput, permitExpires: 1000 })),
    ).rejects.toThrow();
    await expect(
      f.send(
        getDepositInstruction({ ...f.depositInput, mint: attacker.address }),
      ),
    ).rejects.toThrow();
    await f.deposit();
    await expect(
      f.send(
        getCancelRegistrationInstruction({ ...f.actionInput, guest: attacker }),
      ),
    ).rejects.toThrow();
    await f.send(getCancelRegistrationInstruction(f.actionInput));
    await expect(
      f.send(
        getSettleInstruction({
          ...f.settleInput,
          guestTokens: f.penaltyTokens,
        }),
      ),
    ).rejects.toThrow();
    expect(f.balance(f.vault)).toBe(10_000_001n);
  });
});
