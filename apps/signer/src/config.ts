import { open } from 'node:fs/promises';
import {
  address,
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
} from '@solana/kit';
import {
  DEVNET_GENESIS,
  DEVNET_MINT,
  type ServiceRole,
  type SignerPolicy,
} from './policy';
import { devnetChain } from './rpc';
async function secretFile(path: string) {
  // Dedicated service secrets supplied by the operator; never accept keys through HTTP.
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 4096 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('SECRET_FILE_PERMISSIONS');
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function loadSignerConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    env.SOLANA_CLUSTER !== 'devnet' ||
    env.SOLANA_EXPECTED_GENESIS_HASH !== DEVNET_GENESIS
  )
    throw new Error('SIGNER_DEVNET_ONLY');
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Missing ${name}`);
    return v;
  };
  const tokenBytes = await secretFile(need('SERVICE_SIGNER_TOKEN_FILE'));
  const token = tokenBytes.toString('utf8').trim();
  tokenBytes.fill(0);
  if (token.length < 32 || /\s/.test(token))
    throw new Error('SIGNER_TOKEN_LENGTH');
  const keys = {} as Record<ServiceRole, KeyPairSigner>;
  for (const role of ['booking', 'attester', 'payer'] as const) {
    const bytes = await secretFile(
      need(`SIGNER_${role.toUpperCase()}_KEY_FILE`),
    );
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } finally {
      bytes.fill(0);
    }
    if (
      !Array.isArray(raw) ||
      raw.length !== 64 ||
      !raw.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
      throw new Error('SIGNER_KEY_FORMAT');
    const key = Uint8Array.from(raw);
    raw.fill(0);
    try {
      keys[role] = await createKeyPairSignerFromBytes(key);
    } finally {
      key.fill(0);
    }
    if (
      keys[role].address !==
      address(need(`SIGNER_${role.toUpperCase()}_ADDRESS`))
    )
      throw new Error('SIGNER_ADDRESS_MISMATCH');
  }
  const bounded = (name: string, fallback: bigint, upper: bigint) => {
    const v = BigInt(env[name] ?? fallback);
    if (v <= 0n || v > upper) throw new Error(`Invalid ${name}`);
    return v;
  };
  const policy: SignerPolicy = {
    addresses: {
      booking: keys.booking.address,
      attester: keys.attester.address,
      payer: keys.payer.address,
    },
    mint: DEVNET_MINT,
    maxFeeLamports: bounded('SIGNER_MAX_FEE_LAMPORTS', 50000n, 1000000n),
    maxDeposit: bounded(
      'SIGNER_MAX_DEPOSIT_BASE_UNITS',
      1000000000n,
      1000000000000n,
    ),
  };
  const requestsPerMinute = Number(
    bounded('SIGNER_REQUESTS_PER_MINUTE', 60n, 600n),
  );
  const port = Number(bounded('SIGNER_PORT', 8787n, 65535n));
  const chain = devnetChain(need('SOLANA_RPC_URL'));
  await chain.verifyNetwork();
  return { keys, policy, token, chain, requestsPerMinute, port };
}
