import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applicationOrigin,
  DEVNET_GENESIS,
  validateVercelEnvironment,
} from './deployment';
import { checkOrigin, cookie } from './auth';
import { handle } from './http';
import { localSigner } from './chain';

const configured = () => ({
  VERCEL: '1',
  VERCEL_ENV: 'production',
  APP_ORIGIN: 'https://attendback.example.com',
  DATABASE_URL:
    'postgresql://test:test@db.example.com/attendback?sslmode=verify-full',
  SOLANA_CLUSTER: 'devnet',
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_EXPECTED_GENESIS_HASH: DEVNET_GENESIS,
  SERVICE_SIGNER_URL: 'https://signer.example.com/sign',
  SERVICE_SIGNER_TOKEN: 'test-configuration-token-without-real-access',
  SIGNER_BOOKING_ADDRESS: '11111111111111111111111111111111',
  SIGNER_ATTESTER_ADDRESS: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  SIGNER_PAYER_ADDRESS: 'So11111111111111111111111111111111111111112',
  NEXT_PUBLIC_RECOVERY_URL: 'https://recovery.example.com',
});

afterEach(() => vi.unstubAllEnvs());

describe('Vercel deployment boundaries', () => {
  it('accepts complete devnet configuration without connecting to services', () => {
    expect(() => validateVercelEnvironment(configured())).not.toThrow();
  });
  it.each(['localnet', 'mainnet-beta', ''])(
    'rejects unsafe cluster %s',
    (cluster) => {
      expect(() =>
        validateVercelEnvironment({ ...configured(), SOLANA_CLUSTER: cluster }),
      ).toThrow('SOLANA_CLUSTER');
    },
  );
  it('rejects a localhost database, missing TLS, and template values', () => {
    for (const DATABASE_URL of [
      'postgresql://test:test@127.0.0.1/attendback?sslmode=require',
      'postgresql://test:test@db.example.com/attendback',
      'postgresql://test:replace-password@replace-db.invalid/attendback?sslmode=require',
    ])
      expect(() =>
        validateVercelEnvironment({ ...configured(), DATABASE_URL }),
      ).toThrow('DATABASE_URL');
  });
  it('reports configuration names without exposing secret values', () => {
    const secret = 'do-not-print-this-password';
    let message = '';
    try {
      validateVercelEnvironment({
        ...configured(),
        DATABASE_URL: `postgresql://user:${secret}@localhost/db`,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain(secret);
  });
  it('rejects shared service roles and signer key files on the web host', () => {
    const config = configured();
    expect(() =>
      validateVercelEnvironment({
        ...config,
        SIGNER_PAYER_ADDRESS: config.SIGNER_BOOKING_ADDRESS,
      }),
    ).toThrow('distinct');
    expect(() =>
      validateVercelEnvironment({
        ...config,
        SIGNER_BOOKING_KEY_FILE: '/private/key.json',
      }),
    ).toThrow('isolated signer');
  });
  it('rejects HTTP endpoints and non-origin production URLs', () => {
    for (const APP_ORIGIN of [
      'http://attendback.example.com',
      'https://attendback.example.com/',
      'https://attendback.example.com/path',
    ])
      expect(() =>
        validateVercelEnvironment({ ...configured(), APP_ORIGIN }),
      ).toThrow('APP_ORIGIN');
    expect(() =>
      validateVercelEnvironment({
        ...configured(),
        NEXT_PUBLIC_RECOVERY_URL: 'http://localhost:4173',
      }),
    ).toThrow('NEXT_PUBLIC_RECOVERY_URL');
  });
  it('keeps inline signing keys off the web host and protects the workflow scheduler', () => {
    expect(() =>
      validateVercelEnvironment({
        ...configured(),
        SIGNER_PAYER_KEY_BASE64: 'test-key-material',
      }),
    ).toThrow('isolated signer');
    expect(() =>
      validateVercelEnvironment({
        ...configured(),
        RECONCILIATION_MODE: 'workflow',
      }),
    ).toThrow('CRON_SECRET');
    expect(() =>
      validateVercelEnvironment({
        ...configured(),
        RECONCILIATION_MODE: 'workflow',
        CRON_SECRET: 'only-a-test-cron-secret-with-no-real-access',
      }),
    ).not.toThrow();
  });
  it('uses only the exact preview URL even when production APP_ORIGIN is set', () => {
    const env = {
      ...configured(),
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'attendback-abc-team.vercel.app',
    };
    expect(applicationOrigin(env)).toBe(
      'https://attendback-abc-team.vercel.app',
    );
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(() =>
      checkOrigin(
        new Request(
          'https://attendback-abc-team.vercel.app/api/auth/challenge',
          { headers: { origin: 'https://attendback-abc-team.vercel.app' } },
        ),
      ),
    ).not.toThrow();
    expect(() =>
      checkOrigin(
        new Request(
          'https://attendback-abc-team.vercel.app/api/auth/challenge',
          {
            headers: { origin: env.APP_ORIGIN, host: 'attendback.example.com' },
          },
        ),
      ),
    ).toThrow();
    expect(cookie('test')).toContain('; Secure');
  });
  it('allows previews without a production origin but rejects a missing or forged deployment hostname', () => {
    const env = {
      ...configured(),
      APP_ORIGIN: undefined,
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'attendback-abc-team.vercel.app',
    };
    expect(() => validateVercelEnvironment(env)).not.toThrow();
    for (const VERCEL_URL of [
      '',
      'evil.example',
      'attendback.vercel.app/evil',
      'attendback.vercel.app@evil.example',
    ])
      expect(() => validateVercelEnvironment({ ...env, VERCEL_URL })).toThrow(
        'VERCEL_URL',
      );
  });
  it('keeps localhost origin behavior outside Vercel', () => {
    expect(applicationOrigin({})).toBe('http://127.0.0.1:3000');
  });
  it('blocks public API configuration and local test signers if Vercel has local defaults', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('SOLANA_CLUSTER', 'localnet');
    const response = await handle(
      new Request('https://attendback.example.com/api/config'),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'UNAVAILABLE' });
    await expect(localSigner('booking')).rejects.toThrow('SOLANA_CLUSTER');
  });
});
