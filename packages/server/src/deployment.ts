import { address } from '@solana/kit';

type Environment = Record<string, string | undefined>;
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// A preview accepts its own deployment origin, never arbitrary Host headers.
export function applicationOrigin(env: Environment = process.env) {
  if (env.VERCEL === '1' && env.VERCEL_ENV === 'preview') {
    const host = env.VERCEL_URL;
    if (!host || !/^[a-z0-9-]+\.vercel\.app$/i.test(host))
      throw new Error('VERCEL_URL must identify the preview deployment');
    return `https://${host}`;
  }
  return env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
}

function publicHttps(value: string | undefined, originOnly = false) {
  try {
    const url = new URL(value ?? '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.hostname.endsWith('.invalid') &&
      !url.hostname.endsWith('.localhost') &&
      (!originOnly || url.origin === value)
    );
  } catch {
    return false;
  }
}

export function validateVercelEnvironment(env: Environment = process.env) {
  const errors: string[] = [];
  if (env.SOLANA_CLUSTER !== 'devnet') errors.push('SOLANA_CLUSTER=devnet');
  if (env.SOLANA_EXPECTED_GENESIS_HASH !== DEVNET_GENESIS)
    errors.push('SOLANA_EXPECTED_GENESIS_HASH');
  try {
    if (!publicHttps(applicationOrigin(env), true)) errors.push('APP_ORIGIN');
  } catch {
    errors.push('VERCEL_URL');
  }
  for (const key of [
    'SOLANA_RPC_URL',
    'SERVICE_SIGNER_URL',
    'NEXT_PUBLIC_RECOVERY_URL',
  ])
    if (!publicHttps(env[key])) errors.push(key);
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.username ||
      !url.password ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.hostname.endsWith('.invalid') ||
      /replace/i.test(env.DATABASE_URL ?? '') ||
      !['require', 'verify-ca', 'verify-full'].includes(
        url.searchParams.get('sslmode') ?? '',
      )
    )
      errors.push('DATABASE_URL (remote PostgreSQL with TLS)');
  } catch {
    errors.push('DATABASE_URL (remote PostgreSQL with TLS)');
  }
  const roleKeys = [
    'SIGNER_BOOKING_ADDRESS',
    'SIGNER_ATTESTER_ADDRESS',
    'SIGNER_PAYER_ADDRESS',
  ];
  for (const key of roleKeys) {
    try {
      address(env[key] ?? '');
    } catch {
      errors.push(key);
    }
  }
  if (new Set(roleKeys.map((key) => env[key])).size !== 3)
    errors.push('three distinct service signer addresses');
  if (
    !env.SERVICE_SIGNER_TOKEN ||
    env.SERVICE_SIGNER_TOKEN.length < 32 ||
    /replace|secret-manager/i.test(env.SERVICE_SIGNER_TOKEN)
  )
    errors.push('SERVICE_SIGNER_TOKEN (at least 32 characters)');
  if (
    env.DATABASE_POOL_MAX !== undefined &&
    !/^(?:[2-9]|[1-4][0-9]|50)$/.test(env.DATABASE_POOL_MAX)
  )
    errors.push('DATABASE_POOL_MAX (integer 2–50)');
  for (const key of Object.keys(env)) {
    if (
      env[key] &&
      /^SIGNER_.*_KEY_FILE$|^SERVICE_SIGNER_TOKEN_FILE$/.test(key)
    )
      errors.push(`${key} belongs only on the isolated signer host`);
  }
  if (errors.length)
    throw new Error(`Invalid Vercel configuration: ${errors.join(', ')}`);
}

export function assertHostedConfiguration() {
  if (process.env.VERCEL === '1') validateVercelEnvironment();
}
