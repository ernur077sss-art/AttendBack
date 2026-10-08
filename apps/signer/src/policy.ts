import {
  address,
  assertIsTransactionWithinSizeLimit,
  compileTransactionMessage,
  createNoopSigner,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Address,
  type Instruction,
  type Transaction,
  type TransactionWithLifetime,
  type TransactionWithinSizeLimit,
  type ReadonlyUint8Array,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import * as p from '../../../packages/chain-client/src';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_MINT = address(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);
export type ServiceRole = 'booking' | 'attester' | 'payer';
export type SignerPolicy = {
  addresses: Record<ServiceRole, Address>;
  mint: Address;
  maxFeeLamports: bigint;
  maxDeposit: bigint;
};
export type AccountSnapshot = {
  owner: Address;
  data: Uint8Array;
  executable: boolean;
};
export type SignerChain = {
  verifyNetwork(): Promise<void>;
  account(key: Address): Promise<AccountSnapshot | null>;
  time(): Promise<bigint>;
  fee(message: ReadonlyUint8Array): Promise<bigint>;
  simulate(wire: string): Promise<void>;
};
export class SigningDenied extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
function check(value: unknown, code: string): asserts value {
  if (!value) throw new SigningDenied(code);
}
const equal = (a: ReadonlyUint8Array, b: ReadonlyUint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));
const discriminator = (ix: Instruction, bytes: ReadonlyUint8Array) =>
  !!ix.data && equal(ix.data.slice(0, 8), bytes);
const ata = async (owner: Address, mint: Address) =>
  (
    await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];
async function read<T>(
  chain: SignerChain,
  key: Address,
  decoder: { fixedSize: number; decode(data: Uint8Array): T },
  disc: ReadonlyUint8Array,
) {
  const account = await chain.account(key);
  check(
    account &&
      !account.executable &&
      account.owner === p.PROGRAM_ADDRESS &&
      account.data.length === decoder.fixedSize &&
      equal(account.data.slice(0, 8), disc),
    'ACCOUNT',
  );
  return decoder.decode(account.data);
}

/** Rebuild the exact allowed message; additional instructions/accounts/privileges are rejected. */
export async function validateSigning(
  role: ServiceRole,
  wire: string,
  config: SignerPolicy,
  chain: SignerChain,
): Promise<Transaction & TransactionWithLifetime & TransactionWithinSizeLimit> {
  check(
    wire.length <= 5464 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        wire,
      ),
    'WIRE',
  );
  const bytes = Buffer.from(wire, 'base64');
  check(bytes.length > 0 && bytes.length <= 4096, 'WIRE');
  const tx = getTransactionDecoder().decode(bytes);
  assertIsTransactionWithinSizeLimit(tx);
  check(equal(getTransactionEncoder().encode(tx), bytes), 'WIRE');
  const compiled = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  check(compiled.version === 0 || compiled.version === 1, 'VERSION');
  check(
    compiled.version !== 0 || !compiled.addressTableLookups?.length,
    'LOOKUP_TABLE',
  );
  check(compiled.header.numSignerAccounts <= 2, 'SIGNERS');
  check(Object.hasOwn(tx.signatures, config.addresses[role]), 'ROLE');
  const message = decompileTransactionMessage(compiled);
  check('blockhash' in message.lifetimeConstraint, 'NONCE');
  if (message.version === 1) {
    check(
      compiled.version === 1 && (compiled.configMask & ~31) === 0,
      'CONFIG',
    );
    check(
      (message.config?.priorityFeeLamports ?? 0n) <= config.maxFeeLamports,
      'FEE',
    );
    check(
      (message.config?.computeUnitLimit ?? 0) > 0 &&
        message.config!.computeUnitLimit! <= 1_400_000,
      'COMPUTE',
    );
    check(
      (message.config?.loadedAccountsDataSizeLimit ?? 0) > 0 &&
        message.config!.loadedAccountsDataSizeLimit! <= 67_108_864,
      'COMPUTE',
    );
  } else check(bytes.length <= 1232, 'WIRE');

  // v0 supports only bounded, non-duplicated ComputeBudget setters preceding business instructions.
  const budget: Instruction[] = [],
    business: Instruction[] = [],
    seen = new Set<number>();
  for (const ix of message.instructions) {
    if (ix.programAddress !== 'ComputeBudget111111111111111111111111111111') {
      business.push(ix);
      continue;
    }
    check(
      message.version === 0 &&
        !business.length &&
        !ix.accounts?.length &&
        ix.data,
      'COMPUTE',
    );
    const d = Buffer.from(ix.data),
      kind = d[0];
    check(
      !seen.has(kind) &&
        [1, 2, 3, 4].includes(kind) &&
        d.length === (kind === 3 ? 9 : 5),
      'COMPUTE',
    );
    seen.add(kind);
    if (kind === 1)
      check(
        d.readUInt32LE(1) >= 32768 &&
          d.readUInt32LE(1) <= 262144 &&
          d.readUInt32LE(1) % 1024 === 0,
        'COMPUTE',
      );
    if (kind === 2)
      check(d.readUInt32LE(1) > 0 && d.readUInt32LE(1) <= 1_400_000, 'COMPUTE');
    if (kind === 4)
      check(
        d.readUInt32LE(1) > 0 && d.readUInt32LE(1) <= 67_108_864,
        'COMPUTE',
      );
    budget.push(ix);
  }
  const core = business.filter((ix) => ix.programAddress === p.PROGRAM_ADDRESS);
  check(core.length === 1 && business.length <= 3, 'INSTRUCTIONS');
  const ix = core[0],
    accounts = ix.accounts;
  check(accounts && ix.data, 'INSTRUCTIONS');
  const isDeposit = discriminator(ix, p.getDepositDiscriminatorBytes());
  const isAttest = discriminator(ix, p.getAttestPresentDiscriminatorBytes());
  const isNoShow = discriminator(ix, p.getProposeNoShowDiscriminatorBytes());
  const isSettle = discriminator(ix, p.getSettleDiscriminatorBytes());
  const isTimeout = discriminator(ix, p.getTimeoutRefundDiscriminatorBytes());
  check(
    isDeposit || isAttest || isNoShow || isSettle || isTimeout,
    'INSTRUCTIONS',
  );
  check(
    isDeposit
      ? role === 'booking'
      : isAttest || isNoShow
        ? role !== 'booking'
        : role === 'payer',
    'ROLE',
  );
  check(
    accounts.length === (isDeposit ? 10 : isAttest || isNoShow ? 4 : 8),
    'ACCOUNTS',
  );
  const policyAddress = accounts[isDeposit ? 3 : 1].address;
  await chain.verifyNetwork();
  const policy = await read(
    chain,
    policyAddress,
    p.getPolicyDecoder(),
    p.getPolicyDiscriminatorBytes(),
  );
  const terms = policy.terms;
  check(
    policy.mint === config.mint &&
      policy.decimals === 6 &&
      terms.amount > 0n &&
      terms.amount <= config.maxDeposit,
    'MINT_AMOUNT',
  );
  check(
    terms.bookingAuthority === config.addresses.booking &&
      terms.attester === config.addresses.attester,
    'POLICY_ROLE',
  );
  check(
    policyAddress ===
      (await p.policyPda(policy.event, new Uint8Array(policy.id))),
    'PDA',
  );
  const event = await read(
    chain,
    policy.event,
    p.getEventRecordDecoder(),
    p.getEventRecordDiscriminatorBytes(),
  );
  check(
    policy.event ===
      (await p.eventPda(event.authority, new Uint8Array(event.id))),
    'PDA',
  );
  const now = await chain.time();
  const expected: Instruction[] = [];
  if (isDeposit) {
    const guest = accounts[0].address;
    check(
      !Object.values(config.addresses).includes(guest) &&
        guest !== terms.penaltyRecipient,
      'GUEST',
    );
    check(message.feePayer.address === guest && !event.cancelled, 'PAYER');
    const commitment = await p.commitmentPda(policyAddress, guest);
    const data = p.getDepositInstructionDataDecoder().decode(ix.data);
    check(
      data.permitExpires > now &&
        data.permitExpires <= now + 600n &&
        data.permitExpires <= terms.bookingClose,
      'PERMIT',
    );
    check(!(await chain.account(commitment)), 'ALREADY_DEPOSITED');
    expected.push(
      p.getDepositInstruction({
        guest: createNoopSigner(guest),
        bookingAuthority: createNoopSigner(config.addresses.booking),
        event: policy.event,
        policy: policyAddress,
        commitment,
        vault: await p.vaultPda(commitment),
        source: await ata(guest, policy.mint),
        mint: policy.mint,
        permitExpires: data.permitExpires,
      }),
    );
  } else {
    check(message.feePayer.address === config.addresses.payer, 'PAYER');
    const commitmentAddress = accounts[isAttest || isNoShow ? 3 : 2].address;
    const commitment = await read(
      chain,
      commitmentAddress,
      p.getCommitmentDecoder(),
      p.getCommitmentDiscriminatorBytes(),
    );
    check(
      commitment.policy === policyAddress &&
        commitmentAddress ===
          (await p.commitmentPda(policyAddress, commitment.guest)),
      'PDA',
    );
    check(
      commitment.principal === terms.amount &&
        commitment.status !== p.DepositStatus.Settled,
      'STATE',
    );
    const base = {
      event: policy.event,
      policy: policyAddress,
      commitment: commitmentAddress,
    };
    if (isAttest || isNoShow) {
      check(!event.cancelled, 'CANCELLED');
      if (isAttest)
        check(
          !commitment.guestCancelled &&
            [p.DepositStatus.Funded, p.DepositStatus.NoShowProposed].includes(
              commitment.status,
            ) &&
            now >= terms.checkinOpen &&
            now < terms.disputeDeadline,
          'STATE_TIME',
        );
      else
        check(
          commitment.status === p.DepositStatus.Funded &&
            now >= terms.checkinClose &&
            now < terms.proposalCutoff,
          'STATE_TIME',
        );
      expected.push(
        (isAttest
          ? p.getAttestPresentInstruction
          : p.getProposeNoShowInstruction)({
          ...base,
          attester: createNoopSigner(config.addresses.attester),
        }),
      );
    } else {
      if (isTimeout) check(now >= terms.hardRefundAt, 'STATE_TIME');
      check(
        event.cancelled ||
          now >= terms.hardRefundAt ||
          commitment.status === p.DepositStatus.Refundable ||
          (now >= terms.disputeDeadline &&
            [
              p.DepositStatus.NoShowProposed,
              p.DepositStatus.Forfeitable,
            ].includes(commitment.status)),
        'STATE_TIME',
      );
      const guestTokens = await ata(commitment.guest, policy.mint),
        penaltyTokens = await ata(terms.penaltyRecipient, policy.mint);
      for (const [owner, token] of [
        [commitment.guest, guestTokens],
        [terms.penaltyRecipient, penaltyTokens],
      ])
        expected.push(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: createNoopSigner(config.addresses.payer),
            ata: token,
            owner,
            mint: policy.mint,
          }),
        );
      expected.push(
        (isTimeout ? p.getTimeoutRefundInstruction : p.getSettleInstruction)({
          ...base,
          vault: await p.vaultPda(commitmentAddress),
          guestTokens,
          penaltyTokens,
          mint: policy.mint,
        }),
      );
    }
  }
  const rebuilt = getCompiledTransactionMessageEncoder().encode(
    compileTransactionMessage({
      ...message,
      instructions: [...budget, ...expected],
    }),
  );
  check(equal(rebuilt, tx.messageBytes), 'MESSAGE_MISMATCH');
  const fee = await chain.fee(tx.messageBytes);
  check(fee > 0n && fee <= config.maxFeeLamports, 'FEE');
  await chain.simulate(wire);
  return { ...tx, lifetimeConstraint: message.lifetimeConstraint };
}
