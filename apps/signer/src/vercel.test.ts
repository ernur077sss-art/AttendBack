import { generateKeyPairSync } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getAddressDecoder } from '@solana/kit';
import { afterEach, expect, test, vi } from 'vitest';
import { DEVNET_GENESIS } from './policy';
import { devnetChain } from './rpc';
import { loadVercelSignerConfig, vercelSigner } from './vercel';

vi.mock('./rpc', () => ({
  devnetChain: vi.fn(() => ({ verifyNetwork: vi.fn(async () => {}) })),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function environment() {
  const env: Record<string, string> = {
    SOLANA_CLUSTER: 'devnet',
    SOLANA_EXPECTED_GENESIS_HASH: DEVNET_GENESIS,
    SOLANA_RPC_URL: 'https://api.devnet.solana.com',
    SERVICE_SIGNER_TOKEN: 'only-a-test-token-with-no-real-access',
  };
  for (const role of ['BOOKING', 'ATTESTER', 'PAYER']) {
    const pair = generateKeyPairSync('ed25519');
    const seed = pair.privateKey
      .export({ type: 'pkcs8', format: 'der' })
      .subarray(-32);
    const pub = pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32);
    env[`SIGNER_${role}_KEY_BASE64`] = Buffer.from(
      JSON.stringify([...seed, ...pub]),
    ).toString('base64');
    env[`SIGNER_${role}_ADDRESS`] = getAddressDecoder().decode(pub);
  }
  return env;
}

test('serverless signer loads separate role keys and removes temporary secret files', async () => {
  const before = (await readdir(tmpdir())).filter((n) =>
    n.startsWith('attendback-signer-'),
  );
  const env = environment();
  const config = await loadVercelSignerConfig(env);
  expect(config.keys.payer.address).toBe(env.SIGNER_PAYER_ADDRESS);
  expect(config.keys.booking.address).toBe(env.SIGNER_BOOKING_ADDRESS);
  expect(config.keys.attester.address).toBe(env.SIGNER_ATTESTER_ADDRESS);
  expect(devnetChain).toHaveBeenCalledOnce();
  expect(
    (await readdir(tmpdir())).filter((n) => n.startsWith('attendback-signer-')),
  ).toEqual(before);
  expect(env.SIGNER_PAYER_KEY_FILE).toBeUndefined();
});

test('malformed or mismatched serverless secrets fail closed before any network access', async () => {
  const env = environment();
  await expect(
    loadVercelSignerConfig({ ...env, SIGNER_BOOKING_KEY_BASE64: '***' }),
  ).rejects.toThrow('SIGNER_KEY_ENCODING');
  await expect(
    loadVercelSignerConfig({
      ...env,
      SIGNER_PAYER_ADDRESS: env.SIGNER_BOOKING_ADDRESS,
    }),
  ).rejects.toThrow('SIGNER_ADDRESS_MISMATCH');
  await expect(
    loadVercelSignerConfig({ ...env, SOLANA_CLUSTER: 'mainnet-beta' }),
  ).rejects.toThrow('SIGNER_DEVNET_ONLY');
  expect(devnetChain).not.toHaveBeenCalled();
});

test('unauthenticated public requests never initialize keys or use RPC', async () => {
  vi.stubEnv('SERVICE_SIGNER_TOKEN', 'only-a-test-token-with-no-real-access');
  for (const authorization of ['', 'Bearer wrong']) {
    const response = await vercelSigner(
      new Request('https://signer.example.com/api/sign', {
        method: 'POST',
        headers: { authorization },
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
  }
  expect(devnetChain).not.toHaveBeenCalled();
});
