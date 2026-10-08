import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageConfig,
  isTransactionPartialSigner,
  type Instruction,
  type Transaction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { isFailedTransaction } from '@solana/kit-plugin-litesvm';
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import { fixture } from '../../../packages/chain-client/src/fixture';
import * as p from '../../../packages/chain-client/src';
import {
  serviceSigner,
  validSignature,
} from '../../../packages/server/src/chain';
import {
  validateSigning,
  SigningDenied,
  type SignerChain,
  type SignerPolicy,
  type ServiceRole,
} from './policy';
import { createSignerHandler } from './service';
import { loadSignerConfig } from './config';
import { signerHttpServer } from './http';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup() {
  const f = await fixture();
  let clock = 1000n;
  const chain: SignerChain = {
    verifyNetwork: vi.fn(async () => {}),
    account: async (key) => {
      const a = f.svm.getAccount(key);
      return a.exists
        ? {
            owner: a.programAddress,
            data: new Uint8Array(a.data),
            executable: a.executable,
          }
        : null;
    },
    time: async () => clock,
    fee: vi.fn(async () => 10000n),
    simulate: vi.fn(async (wire) => {
      f.svm.withSigverify(false);
      try {
        const result = f.svm.simulateTransaction(
          getTransactionDecoder().decode(Buffer.from(wire, 'base64')),
        );
        if (isFailedTransaction(result)) throw new SigningDenied('SIMULATION');
      } finally {
        f.svm.withSigverify(true);
      }
    }),
  };
  const policy: SignerPolicy = {
    addresses: {
      booking: f.booking.address,
      attester: f.attester.address,
      payer: f.feePayer.address,
    },
    mint: f.mint,
    maxFeeLamports: 50000n,
    maxDeposit: 1000000000n,
  };
  const keys = { booking: f.booking, attester: f.attester, payer: f.feePayer };
  const token = 'only-for-local-tests-never-a-deployment-secret';
  const log = vi.fn();
  const handler = createSignerHandler({ keys, policy, chain, token, log });
  async function wire(
    instructions: Instruction[],
    version: 0 | 1 = 1,
    feePayer = f.feePayer.address,
    priorityFeeLamports = 0n,
  ) {
    const lifetime = (await f.client.rpc.getLatestBlockhash().send()).value;
    const message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageLifetimeUsingBlockhash(
        lifetime,
        setTransactionMessageFeePayer(
          feePayer,
          createTransactionMessage({ version }),
        ),
      ),
    );
    const configured =
      version === 1
        ? setTransactionMessageConfig(
            {
              computeUnitLimit: 1000000,
              loadedAccountsDataSizeLimit: 1048576,
              priorityFeeLamports,
            },
            { ...message, version: 1 },
          )
        : message;
    return getBase64EncodedWireTransaction(compileTransaction(configured));
  }
  const depositWire = (version: 0 | 1 = 1) =>
    wire([p.getDepositInstruction(f.depositInput)], version, f.guest.address);
  const request = (
    role: ServiceRole,
    transactions: string[],
    auth = `Bearer ${token}`,
  ) =>
    new Request('https://signer.example/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: auth },
      body: JSON.stringify({
        role,
        cluster: 'devnet',
        program: p.PROGRAM_ADDRESS,
        transactions,
      }),
    });
  const settlement = (timeout = false): Instruction[] => [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: f.feePayer,
      ata: f.guestTokens,
      owner: f.guest.address,
      mint: f.mint,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: f.feePayer,
      ata: f.penaltyTokens,
      owner: f.beneficiary.address,
      mint: f.mint,
    }),
    (timeout ? p.getTimeoutRefundInstruction : p.getSettleInstruction)(
      f.settleInput,
    ),
  ];
  return {
    ...f,
    chain,
    policy,
    keys,
    token,
    handler,
    request,
    wire,
    depositWire,
    settlement,
    log,
    time: (t: number) => {
      clock = BigInt(t);
      f.time(t);
    },
  };
}
describe('stage 9: isolated signer and real SBF simulation', () => {
  test('real HTTP transport returns a valid signature and closes oversized requests', async () => {
    const f = await setup(),
      server = signerHttpServer(f.handler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const endpoint = server.address();
      if (!endpoint || typeof endpoint === 'string') throw new Error('No port');
      const url = `http://127.0.0.1:${endpoint.port}`;
      expect((await fetch(`${url}/health`)).status).toBe(200);
      const wire = await f.depositWire(),
        request = f.request('booking', [wire]);
      const response = await fetch(`${url}/sign`, {
        method: 'POST',
        headers: request.headers,
        body: await request.text(),
      });
      expect(response.status).toBe(200);
      const tx = getTransactionDecoder().decode(Buffer.from(wire, 'base64'));
      expect(
        validSignature(
          f.booking.address,
          tx.messageBytes,
          Buffer.from((await response.json()).signatures[0], 'base64'),
        ),
      ).toBe(true);
      const oversized = await fetch(`${url}/sign`, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ pad: 'x'.repeat(30000) }),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  test.each([0, 1] as const)(
    'booking co-signs only the original v%s deposit; backend accepts signature',
    async (version) => {
      const f = await setup(),
        wire = await f.depositWire(version);
      vi.stubEnv('SOLANA_CLUSTER', 'devnet');
      vi.stubEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com');
      vi.stubEnv('SERVICE_SIGNER_URL', 'https://signer.example/sign');
      vi.stubEnv('SERVICE_SIGNER_TOKEN', f.token);
      vi.stubEnv('SIGNER_BOOKING_ADDRESS', f.booking.address);
      vi.stubGlobal(
        'fetch',
        vi.fn((url, init) => f.handler(new Request(url, init))),
      );
      const remote = await serviceSigner('booking');
      if (!isTransactionPartialSigner(remote))
        throw new Error('Expected partial signer');
      const tx = await validateSigning('booking', wire, f.policy, f.chain);
      const signed = await remote.signTransactions([tx]);
      expect(
        validSignature(
          f.booking.address,
          tx.messageBytes,
          new Uint8Array(signed[0][f.booking.address]),
        ),
      ).toBe(true);
      const again = await f.handler(f.request('booking', [wire]));
      expect(again.status).toBe(200);
      expect((await again.json()).signatures[0]).toBe(
        Buffer.from(signed[0][f.booking.address]).toString('base64'),
      );
    },
  );
  test('attester and worker payer sign attendance and no-show with separate keys', async () => {
    const f = await setup();
    await f.deposit();
    f.time(1200);
    const wire = await f.wire([p.getAttestPresentInstruction(f.attendInput)]);
    for (const role of ['attester', 'payer'] as const) {
      const result = await f.handler(f.request(role, [wire]));
      expect(result.status).toBe(200);
      const tx = getTransactionDecoder().decode(Buffer.from(wire, 'base64'));
      expect(
        validSignature(
          f.keys[role].address,
          tx.messageBytes,
          Buffer.from((await result.json()).signatures[0], 'base64'),
        ),
      ).toBe(true);
    }
    f.time(1400);
    await expect(
      validateSigning(
        'attester',
        await f.wire([p.getProposeNoShowInstruction(f.attendInput)]),
        f.policy,
        f.chain,
      ),
    ).resolves.toBeDefined();
  });
  test('worker settlement supports exactly the fixed guest and penalty ATAs', async () => {
    const f = await setup();
    await f.deposit();
    f.time(1200);
    await f.send(p.getAttestPresentInstruction(f.attendInput));
    const wire = await f.wire(f.settlement());
    await expect(
      validateSigning('payer', wire, f.policy, f.chain),
    ).resolves.toBeDefined();
    const tampered = f.settlement();
    tampered[0] = getCreateAssociatedTokenIdempotentInstruction({
      payer: f.feePayer,
      ata: f.penaltyTokens,
      owner: f.beneficiary.address,
      mint: f.mint,
    });
    await expect(
      validateSigning('payer', await f.wire(tampered), f.policy, f.chain),
    ).rejects.toThrow('MESSAGE_MISMATCH');
  });
  test('timeout wins over a dispute and refuses a second settlement', async () => {
    const f = await setup();
    await f.deposit();
    f.time(1400);
    await f.send(p.getOpenDisputeInstruction(f.actionInput));
    f.time(1800);
    await expect(
      validateSigning(
        'payer',
        await f.wire(f.settlement(true)),
        f.policy,
        f.chain,
      ),
    ).resolves.toBeDefined();
    await f.send(p.getTimeoutRefundInstruction(f.settleInput));
    await expect(
      validateSigning(
        'payer',
        await f.wire(f.settlement(true)),
        f.policy,
        f.chain,
      ),
    ).rejects.toThrow('STATE');
  });
  test('rejects an extra SOL transfer, unexpected role and foreign fee payer', async () => {
    const f = await setup(),
      deposit = p.getDepositInstruction(f.depositInput);
    const malicious = await f.wire(
      [
        deposit,
        getTransferSolInstruction({
          source: f.guest,
          destination: f.beneficiary.address,
          amount: 1n,
        }),
      ],
      1,
      f.guest.address,
    );
    await expect(
      validateSigning('booking', malicious, f.policy, f.chain),
    ).rejects.toThrow('MESSAGE_MISMATCH');
    await expect(
      validateSigning('payer', await f.depositWire(), f.policy, f.chain),
    ).rejects.toThrow('ROLE');
    await expect(
      validateSigning('booking', await f.wire([deposit]), f.policy, f.chain),
    ).rejects.toThrow();
  });
  test('rejects privilege escalation, changed vault and trailing instruction bytes', async () => {
    const f = await setup(),
      deposit = p.getDepositInstruction(f.depositInput);
    const bad = [
      {
        ...deposit,
        accounts: deposit.accounts.map((a, i) =>
          i === 1 ? { ...a, role: 3 as const } : a,
        ),
      },
      p.getDepositInstruction({ ...f.depositInput, vault: f.guestTokens }),
      {
        ...deposit,
        data: Buffer.concat([Buffer.from(deposit.data), Buffer.from([1])]),
      },
    ];
    for (const ix of bad)
      await expect(
        validateSigning(
          'booking',
          await f.wire([ix], 1, f.guest.address),
          f.policy,
          f.chain,
        ),
      ).rejects.toThrow('MESSAGE_MISMATCH');
  });
  test('rejects excessive v1 priority fees and v0 RPC fee quote', async () => {
    const f = await setup();
    await expect(
      validateSigning(
        'booking',
        await f.wire(
          [p.getDepositInstruction(f.depositInput)],
          1,
          f.guest.address,
          50001n,
        ),
        f.policy,
        f.chain,
      ),
    ).rejects.toThrow('FEE');
    f.chain.fee = async () => 50001n;
    await expect(
      validateSigning('booking', await f.depositWire(0), f.policy, f.chain),
    ).rejects.toThrow('FEE');
  });
  test('rejects expired permit, wrong mint, forged owner and network failure', async () => {
    const f = await setup(),
      wire = await f.depositWire();
    f.time(1100);
    await expect(
      validateSigning('booking', wire, f.policy, f.chain),
    ).rejects.toThrow('PERMIT');
    f.time(1000);
    await expect(
      validateSigning(
        'booking',
        wire,
        { ...f.policy, mint: f.beneficiary.address },
        f.chain,
      ),
    ).rejects.toThrow('MINT_AMOUNT');
    const original = f.chain.account;
    f.chain.account = async (key) => {
      const a = await original(key);
      return a ? { ...a, owner: f.guest.address } : null;
    };
    await expect(
      validateSigning('booking', wire, f.policy, f.chain),
    ).rejects.toThrow('ACCOUNT');
    f.chain.verifyNetwork = async () => {
      throw new SigningDenied('NETWORK');
    };
    await expect(
      validateSigning('booking', wire, f.policy, f.chain),
    ).rejects.toThrow('NETWORK');
  });
  test('no signature is requested if simulation fails or any batch element is invalid', async () => {
    const f = await setup(),
      sign = vi.fn(f.booking.signTransactions);
    const handler = createSignerHandler({
      ...f,
      keys: { ...f.keys, booking: { ...f.booking, signTransactions: sign } },
    });
    const wire = await f.depositWire();
    expect(
      (await handler(f.request('booking', [wire, 'AA==']))).status,
    ).not.toBe(200);
    expect(sign).not.toHaveBeenCalled();
    f.chain.simulate = async () => {
      throw new SigningDenied('SIMULATION');
    };
    expect((await handler(f.request('booking', [wire]))).status).toBe(400);
    expect(sign).not.toHaveBeenCalled();
  });
  test('HTTP contract enforces authentication, origin, schema and body limits without leaking input', async () => {
    const f = await setup(),
      wire = await f.depositWire();
    expect(
      (await f.handler(f.request('booking', [wire], 'Bearer wrong'))).status,
    ).toBe(401);
    const browser = f.request('booking', [wire]);
    browser.headers.set('origin', 'https://evil.example');
    expect((await f.handler(browser)).status).toBe(403);
    const huge = new Request('https://signer.example/sign', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${f.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ secret: 'x'.repeat(25000) }),
    });
    expect((await f.handler(huge)).status).toBe(413);
    const wrongCluster = f.request('booking', [wire]);
    const body = await wrongCluster.json();
    body.cluster = 'mainnet';
    expect(
      (
        await f.handler(
          new Request(wrongCluster.url, {
            method: 'POST',
            headers: wrongCluster.headers,
            body: JSON.stringify(body),
          }),
        )
      ).status,
    ).toBe(400);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.token);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(wire);
  });
  test('request quota limits a privileged caller and startup refuses mainnet before reading secrets', async () => {
    const f = await setup(),
      wire = await f.depositWire();
    const handler = createSignerHandler({ ...f, requestsPerMinute: 1 });
    expect((await handler(f.request('booking', [wire]))).status).toBe(200);
    expect((await handler(f.request('booking', [wire]))).status).toBe(429);
    await expect(
      loadSignerConfig({ SOLANA_CLUSTER: 'mainnet' }),
    ).rejects.toThrow('SIGNER_DEVNET_ONLY');
  });
});
