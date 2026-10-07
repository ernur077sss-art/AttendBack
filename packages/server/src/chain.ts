import { fetchSysvarClock } from '@solana/sysvars';
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageConfig,
  address,
  createClient,
  createSolanaRpc,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signatureBytes,
  type Address,
  type Instruction,
  type TransactionSigner,
  type TransactionPartialSigner,
  type Base64EncodedWireTransaction,
  type Signature,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { signer } from '@solana/kit-plugin-signer';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { DomainError } from '../../domain/src/index';
import {
  PROGRAM_ADDRESS,
  getPolicyDecoder,
  getPolicySize,
  getPolicyDiscriminatorBytes,
  getCommitmentDecoder,
  getCommitmentSize,
  getCommitmentDiscriminatorBytes,
  getEventRecordDecoder,
  getEventRecordSize,
  getEventRecordDiscriminatorBytes,
} from '../../chain-client/src/index';
export function network() {
  const cluster = process.env.SOLANA_CLUSTER ?? 'localnet';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
  const url = new URL(rpcUrl);
  if (!['localnet', 'devnet'].includes(cluster))
    throw new DomainError('NETWORK', 'Разрешены только localnet и devnet', 503);
  if (
    cluster === 'localnet' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    throw new DomainError('NETWORK', 'Localnet RPC должен быть локальным', 503);
  if (cluster === 'devnet' && url.protocol !== 'https:')
    throw new DomainError('NETWORK', 'Devnet RPC требует HTTPS', 503);
  return { cluster, rpcUrl };
}
export const rpc = () => createSolanaRpc(network().rpcUrl);
export async function localSigner(role: string) {
  if (network().cluster !== 'localnet')
    throw new Error('Public test seeds are forbidden outside localnet');
  return createKeyPairSignerFromPrivateKeyBytes(
    createHash('sha256').update(`AttendBack local test only: ${role}`).digest(),
  );
}
export async function serviceSigner(
  role: 'booking' | 'attester' | 'payer',
): Promise<TransactionSigner> {
  if (network().cluster === 'localnet') return localSigner(role);
  const signerAddress = address(
    process.env[`SIGNER_${role.toUpperCase()}_ADDRESS`] ?? '',
  );
  const endpoint = process.env.SERVICE_SIGNER_URL;
  if (!endpoint || !endpoint.startsWith('https:'))
    throw new DomainError(
      'SIGNER',
      'Требуется настроенный сервис подписи для devnet',
      503,
    );
  const remote: TransactionPartialSigner = {
    address: signerAddress,
    signTransactions: async (transactions) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SERVICE_SIGNER_TOKEN ?? ''}`,
        },
        body: JSON.stringify({
          role,
          cluster: 'devnet',
          program: PROGRAM_ADDRESS,
          transactions: transactions.map((t) =>
            getBase64EncodedWireTransaction(t),
          ),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Signer unavailable');
      const data = await response.json();
      if (
        !Array.isArray(data.signatures) ||
        data.signatures.length !== transactions.length
      )
        throw new Error('Invalid signer response');
      return data.signatures.map((s: string, i: number) => {
        const bytes = Buffer.from(s, 'base64');
        if (!validSignature(signerAddress, transactions[i].messageBytes, bytes))
          throw new Error('Invalid service signature');
        return { [signerAddress]: signatureBytes(bytes) };
      });
    },
  };
  return remote;
}
export function validSignature(
  wallet: Address,
  message: ReadonlyUint8Array,
  signature: Uint8Array,
) {
  if (signature.length !== 64) return false;
  const key = createPublicKey({
    format: 'der',
    type: 'spki',
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(getAddressEncoder().encode(wallet)),
    ]),
  });
  return verify(null, Buffer.from(message), key, signature);
}
export async function prepare(
  payer: TransactionSigner,
  instructions: Instruction[],
  version: 0 | 1 = 1,
) {
  const n = network();
  if (n.cluster === 'devnet') {
    const expected = process.env.SOLANA_EXPECTED_GENESIS_HASH;
    if (
      !expected ||
      (await rpc()
        .getGenesisHash()
        .send({ abortSignal: AbortSignal.timeout(12000) })) !== expected
    )
      throw new DomainError(
        'GENESIS',
        'Проверьте genesis hash выбранной devnet',
        503,
      );
  }
  const client = createClient()
    .use(signer(payer))
    .use(solanaRpc({ rpcUrl: n.rpcUrl, transactionConfig: { version } })); // Surfpool 1.6 reports 139 loaded bytes for a transaction loading our 265 KiB program.
  // Keep compute estimation; explicitly cap local v1 loaded data at 1 MiB, then simulate again.
  const input =
    n.cluster === 'localnet' && version === 1
      ? pipe(
          createTransactionMessage({ version: 1 }),
          (m) => setTransactionMessageFeePayerSigner(payer, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
          (m) =>
            setTransactionMessageConfig(
              { loadedAccountsDataSizeLimit: 1_048_576 },
              m,
            ),
        )
      : instructions;
  const result = await client.signTransaction(input, {
    abortSignal: AbortSignal.timeout(12000),
  });
  const wire = result.context.transactionBase64;
  const simulation = await client.rpc
    .simulateTransaction(wire, {
      encoding: 'base64',
      sigVerify: false,
      commitment: 'confirmed',
    })
    .send({ abortSignal: AbortSignal.timeout(12000) });
  if (simulation.value.err) {
    const error = new DomainError(
      'SIMULATION',
      'Транзакция не прошла симуляцию. Обновите состояние.',
      409,
    );
    error.cause = {
      error: simulation.value.err,
      logs: simulation.value.logs,
      resourceConfig:
        'config' in result.context.message
          ? result.context.message.config
          : null,
    };
    throw error;
  }
  return {
    wire,
    lastValidBlockHeight:
      result.context.message.lifetimeConstraint.lastValidBlockHeight.toString(),
    simulation: {
      ok: true,
      units: simulation.value.unitsConsumed?.toString() ?? null,
    },
    transaction: result.context.transaction,
  };
}
export function verifySignedWire(expectedWire: string, signedWire: string) {
  const expected = getTransactionDecoder().decode(
    Buffer.from(expectedWire, 'base64'),
  );
  const actual = getTransactionDecoder().decode(
    Buffer.from(signedWire, 'base64'),
  );
  if (
    !Buffer.from(expected.messageBytes).equals(Buffer.from(actual.messageBytes))
  )
    throw new DomainError(
      'CHANGED_TRANSACTION',
      'Кошелёк изменил подготовленную транзакцию',
      400,
    );
  for (const [wallet, sig] of Object.entries(actual.signatures)) {
    if (
      !sig ||
      !validSignature(address(wallet), actual.messageBytes, new Uint8Array(sig))
    )
      throw new DomainError(
        'INVALID_SIGNATURE',
        'Не все подписи транзакции действительны',
        400,
      );
  }
  return getSignatureFromTransaction(actual);
}
export async function broadcast(wire: string) {
  return rpc()
    .sendTransaction(wire as Base64EncodedWireTransaction, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3n,
    })
    .send({ abortSignal: AbortSignal.timeout(12000) });
}
export async function signatureStatus(sig: string) {
  return (
    await rpc()
      .getSignatureStatuses([sig as Signature], {
        searchTransactionHistory: true,
      })
      .send({ abortSignal: AbortSignal.timeout(12000) })
  ).value[0];
}
function decodeChecked<T>(
  value: { owner: string; data: readonly [string, string] } | null,
  size: number,
  discriminator: ReadonlyUint8Array,
  decoder: { decode: (data: Uint8Array) => T },
): T | null {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  if (
    value.owner !== PROGRAM_ADDRESS ||
    data.length !== size ||
    !data.subarray(0, 8).equals(Buffer.from(discriminator))
  )
    throw new DomainError(
      'CHAIN_ACCOUNT',
      'Неверный владелец или формат on-chain аккаунта',
      503,
    );
  return decoder.decode(data);
}
export async function policySnapshot(event: Address, policy: Address) {
  const response = await rpc()
    .getMultipleAccounts([event, policy], {
      encoding: 'base64',
      commitment: 'finalized',
    })
    .send({ abortSignal: AbortSignal.timeout(12000) });
  return {
    slot: response.context.slot,
    event: decodeChecked(
      response.value[0],
      getEventRecordSize(),
      getEventRecordDiscriminatorBytes(),
      getEventRecordDecoder(),
    ),
    policy: decodeChecked(
      response.value[1],
      getPolicySize(),
      getPolicyDiscriminatorBytes(),
      getPolicyDecoder(),
    ),
  };
}
export async function depositSnapshot(
  event: Address,
  policy: Address,
  commitment: Address,
  minContextSlot?: bigint,
) {
  const response = await rpc()
    .getMultipleAccounts([event, policy, commitment], {
      encoding: 'base64',
      commitment: 'finalized',
      minContextSlot,
    })
    .send({ abortSignal: AbortSignal.timeout(12000) });
  return {
    slot: response.context.slot,
    event: decodeChecked(
      response.value[0],
      getEventRecordSize(),
      getEventRecordDiscriminatorBytes(),
      getEventRecordDecoder(),
    ),
    policy: decodeChecked(
      response.value[1],
      getPolicySize(),
      getPolicyDiscriminatorBytes(),
      getPolicyDecoder(),
    ),
    deposit: decodeChecked(
      response.value[2],
      getCommitmentSize(),
      getCommitmentDiscriminatorBytes(),
      getCommitmentDecoder(),
    ),
  };
}
export { createNoopSigner };

export async function chainTime() {
  return Number(
    (
      await fetchSysvarClock(rpc(), {
        commitment: 'finalized',
        abortSignal: AbortSignal.timeout(12000),
      })
    ).unixTimestamp,
  );
}
