import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { KeyPairSigner } from '@solana/kit';
import { PROGRAM_ADDRESS } from '../../../packages/chain-client/src';
import {
  SigningDenied,
  validateSigning,
  type ServiceRole,
  type SignerChain,
  type SignerPolicy,
} from './policy';

const requestSchema = z
  .object({
    role: z.enum(['booking', 'attester', 'payer']),
    cluster: z.literal('devnet'),
    program: z.literal(PROGRAM_ADDRESS),
    transactions: z.array(z.string().min(1).max(5464)).min(1).max(4),
  })
  .strict();
const hash = (value: string) => createHash('sha256').update(value).digest();
export const MAX_BODY = 24000;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SigningDenied('BODY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new SigningDenied('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createSignerHandler(options: {
  keys: Record<ServiceRole, KeyPairSigner>;
  policy: SignerPolicy;
  chain: SignerChain;
  token: string;
  requestsPerMinute?: number;
  log?: (record: Record<string, unknown>) => void;
}) {
  if (options.token.length < 32) throw new Error('SIGNER_TOKEN_LENGTH');
  for (const role of ['booking', 'attester', 'payer'] as const)
    if (options.keys[role].address !== options.policy.addresses[role])
      throw new Error('SIGNER_ADDRESS_MISMATCH');
  if (new Set(Object.values(options.policy.addresses)).size !== 3)
    throw new Error('SIGNER_DISTINCT_ROLES');
  const authHash = hash(`Bearer ${options.token}`);
  let active = 0,
    windowStart = Date.now(),
    used = 0;
  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health')
      return json({
        service: 'attendback-signer',
        cluster: 'devnet',
        status: 'keys_loaded',
      });
    if (path !== '/sign' || request.method !== 'POST')
      return json({ error: 'NOT_FOUND' }, 404);
    if (
      !timingSafeEqual(
        authHash,
        hash(request.headers.get('authorization') ?? ''),
      )
    )
      return json({ error: 'UNAUTHORIZED' }, 401);
    // No cross-origin browser clients or permissive CORS on this server-to-server endpoint.
    if (request.headers.has('origin')) return json({ error: 'ORIGIN' }, 403);
    if (
      request.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json'
    )
      return json({ error: 'CONTENT_TYPE' }, 415);
    const now = Date.now();
    if (now - windowStart >= 60000) {
      windowStart = now;
      used = 0;
    }
    if (active >= 4 || used >= (options.requestsPerMinute ?? 60))
      return json({ error: 'RATE_LIMIT' }, 429);
    active++;
    used++;
    const id = randomUUID();
    let role: ServiceRole | undefined;
    try {
      const input = requestSchema.parse(await boundedBody(request));
      role = input.role;
      const transactions = [];
      // Validate the entire batch before requesting any signature.
      for (const wire of input.transactions)
        transactions.push(
          await validateSigning(role, wire, options.policy, options.chain),
        );
      const signingRole = input.role;
      const signed =
        await options.keys[signingRole].signTransactions(transactions);
      const signatures = signed.map((dict) => {
        const sig = dict[options.policy.addresses[signingRole]];
        if (!sig || sig.length !== 64) throw new Error('SIGNATURE');
        return Buffer.from(sig).toString('base64');
      });
      options.log?.({
        id,
        role,
        result: 'signed',
        messageHashes: transactions.map((tx) =>
          createHash('sha256')
            .update(Buffer.from(tx.messageBytes))
            .digest('hex'),
        ),
      });
      return json({ signatures });
    } catch (error) {
      const code =
        error instanceof SigningDenied
          ? error.code
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 'REQUEST'
            : 'UNAVAILABLE';
      options.log?.({ id, role, result: 'rejected', code });
      return json(
        { error: code },
        code === 'BODY_LIMIT' ? 413 : code === 'UNAVAILABLE' ? 503 : 400,
      );
    } finally {
      active--;
    }
  };
}
