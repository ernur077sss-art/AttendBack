import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { loadSignerConfig } from './config';
import { createSignerHandler } from './service';

// Only the isolated signer project receives these Vercel Sensitive variables.
// Private key material is never returned to clients or imported by the web app.
export async function loadVercelSignerConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'attendback-signer-'));
  const local = { ...env };
  try {
    const token = env.SERVICE_SIGNER_TOKEN;
    if (!token || token.length < 32) throw new Error('SIGNER_TOKEN_LENGTH');
    local.SERVICE_SIGNER_TOKEN_FILE = path.join(dir, 'token');
    await writeFile(local.SERVICE_SIGNER_TOKEN_FILE, token, {
      mode: 0o600,
      flag: 'wx',
    });
    for (const role of ['BOOKING', 'ATTESTER', 'PAYER']) {
      const value = env[`SIGNER_${role}_KEY_BASE64`];
      if (
        !value ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
        value.length > 4096
      )
        throw new Error('SIGNER_KEY_ENCODING');
      const bytes = Buffer.from(value, 'base64');
      try {
        if (bytes.toString('base64') !== value)
          throw new Error('SIGNER_KEY_ENCODING');
        const file = path.join(dir, `${role}.json`);
        await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
        local[`SIGNER_${role}_KEY_FILE`] = file;
      } finally {
        bytes.fill(0);
      }
    }
    return await loadSignerConfig(local);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let initialized: Promise<ReturnType<typeof createSignerHandler>> | undefined;
const hash = (s: string) => createHash('sha256').update(s).digest();
export async function vercelSigner(request: Request) {
  const token = process.env.SERVICE_SIGNER_TOKEN;
  // Reject unauthenticated traffic before loading keys or using the RPC quota.
  if (
    !token ||
    token.length < 32 ||
    !timingSafeEqual(
      hash(request.headers.get('authorization') ?? ''),
      hash(`Bearer ${token}`),
    )
  )
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    initialized ??= loadVercelSignerConfig()
      .then((config) =>
        createSignerHandler({
          ...config,
          log: (record) =>
            console.log(JSON.stringify({ service: 'signer', ...record })),
        }),
      )
      .catch((error) => {
        initialized = undefined;
        throw error;
      });
    const handler = await initialized;
    const url = new URL(request.url);
    url.pathname = url.pathname === '/api/health' ? '/health' : '/sign';
    return await handler(new Request(url, request));
  } catch {
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
