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

export async function fixture(overrides: Partial<TermsArgs> = {}) {
  const [
    feePayer,
    authority,
    guest,
    booking,
    attester,
    resolver,
    beneficiary,
    mintSigner,
  ] = await Promise.all(
    Array.from({ length: 8 }, () => generateKeyPairSigner()),
  );
  const client = createClient()
    .use(signer(feePayer))
    .use(litesvm({ transactionConfig: { version: 1 } }));
  const svm = client.svm;
  svm.addProgramFromFile(PROGRAM_ADDRESS, 'target/deploy/attendback.so');
  for (const s of [feePayer, authority, guest])
    svm.airdrop(s.address, lamports(10_000_000_000n));
  const time = (t: number) => {
    svm.setClock(new Clock(10n, 0n, 0n, 0n, BigInt(t)));
    svm.expireBlockhash();
  };
  time(1000);
  const send = async (ix: Instruction) => {
    svm.expireBlockhash();
    return client.sendTransaction(ix);
  };
  const mint = mintSigner.address;
  const set = (address: Address, data: ReadonlyUint8Array) =>
    svm.setAccount({
      address,
      data,
      space: BigInt(data.length),
      executable: false,
      programAddress: TOKEN_PROGRAM_ADDRESS,
      lamports: lamports(
        svm.minimumBalanceForRentExemption(BigInt(data.length)),
      ),
    });
  set(
    mint,
    getMintEncoder().encode({
      mintAuthority: none(),
      supply: 1_000_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthority: none(),
    }),
  );
  const [guestTokens] = await findAssociatedTokenPda({
    owner: guest.address,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [penaltyTokens] = await findAssociatedTokenPda({
    owner: beneficiary.address,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const seedToken = (address: Address, owner: Address, amount: bigint) =>
    set(
      address,
      getTokenEncoder().encode({
        mint,
        owner,
        amount,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
      }),
    );
  seedToken(guestTokens, guest.address, 1_000_000_000n);
  seedToken(penaltyTokens, beneficiary.address, 0n);
  const eventId = idBytes(randomUUID()),
    policyId = idBytes(randomUUID());
  const event = await eventPda(authority.address, eventId);
  const policy = await policyPda(event, policyId);
  const commitment = await commitmentPda(policy, guest.address);
  const vault = await vaultPda(commitment);
  const terms: TermsArgs = {
    amount: 10_000_001n,
    penaltyBps: 5000,
    bookingAuthority: booking.address,
    attester: attester.address,
    resolver: resolver.address,
    penaltyRecipient: beneficiary.address,
    bookingClose: 1400,
    freeCancelUntil: 1150,
    checkinOpen: 1200,
    checkinClose: 1400,
    proposalCutoff: 1500,
    disputeDeadline: 1600,
    resolutionDeadline: 1700,
    hardRefundAt: 1800,
    termsHash: new Uint8Array(32).fill(7),
    ...overrides,
  };
  await send(
    getCreateEventInstruction({
      authority,
      event,
      id: eventId,
      cancelDeadline: 1600,
    }),
  );
  await send(
    getPublishPolicyInstruction({
      authority,
      event,
      policy,
      mint,
      id: policyId,
      terms,
    }),
  );
  const depositInput = {
    guest,
    bookingAuthority: booking,
    event,
    policy,
    commitment,
    vault,
    source: guestTokens,
    mint,
    permitExpires: 1100,
  };
  const settleInput = {
    event,
    policy,
    commitment,
    vault,
    guestTokens,
    penaltyTokens,
    mint,
  };
  const actionInput = { guest, event, policy, commitment };
  const attendInput = { attester, event, policy, commitment };
  const deposit = () => send(getDepositInstruction(depositInput));
  const state = () => {
    const a = svm.getAccount(commitment);
    if (!a.exists) throw new Error('Missing commitment');
    return getCommitmentDecoder().decode(a.data);
  };
  const balance = (address: Address) => {
    const a = svm.getAccount(address);
    if (!a.exists) return 0n;
    return getTokenDecoder().decode(a.data).amount;
  };
  return {
    client,
    svm,
    send,
    time,
    authority,
    guest,
    booking,
    attester,
    resolver,
    beneficiary,
    event,
    policy,
    commitment,
    vault,
    mint,
    guestTokens,
    penaltyTokens,
    terms,
    deposit,
    depositInput,
    settleInput,
    actionInput,
    attendInput,
    state,
    balance,
    seedToken,
  };
}

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
