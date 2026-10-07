import * as chainService from './chain-service';
import { z, ZodError } from 'zod';
import { pool } from '../../db/src/index';
import { DomainError, walletSchema } from '../../domain/src/index';
import {
  authenticatedWallet,
  challenge,
  verifyChallenge,
  checkOrigin,
  cookie,
  sha256,
  rateLimit,
} from './auth';
import * as service from './service';
const uuid = z.string().uuid();
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(
    JSON.parse(
      JSON.stringify(value, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ),
    { status, headers: { 'Cache-Control': 'no-store', ...extra } },
  );
async function body(req: Request, max = 65536) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > max) {
        await reader.cancel();
        throw new DomainError('TOO_LARGE', 'Запрос слишком большой', 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new DomainError('JSON', 'Некорректный JSON', 400);
  }
}
export async function handle(req: Request) {
  try {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean).slice(1);
    const key = parts.join('/'),
      method = req.method;
    if (method === 'GET' && key === 'config')
      return json(await chainService.publicConfig());
    if (method === 'GET' && key === 'events')
      return json(await service.listEvents());
    if (method !== 'GET') checkOrigin(req);
    if (method === 'POST' && key === 'auth/challenge') {
      const b = z.object({ wallet: walletSchema }).parse(await body(req));
      return json(await challenge(b.wallet));
    }
    if (method === 'POST' && key === 'auth/verify') {
      const b = z
        .object({ id: uuid, signature: z.string().min(80).max(100) })
        .parse(await body(req));
      await rateLimit(`verify:${b.id}`, 10);
      const result = await verifyChallenge(b.id, b.signature);
      return json({ wallet: result.wallet }, 200, {
        'Set-Cookie': cookie(result.token),
      });
    }
    if (method === 'GET' && parts[0] === 'events' && parts.length === 2) {
      let wallet: string | undefined;
      try {
        wallet = await authenticatedWallet(req);
      } catch {}
      return json(await service.eventDetail(uuid.parse(parts[1]), wallet));
    }
    const wallet = await authenticatedWallet(req);
    if (method === 'POST' && key === 'local/fund') {
      await rateLimit(`faucet:${wallet}`, 5);
      return json(await chainService.fundLocalWallet(wallet));
    }
    if (method === 'GET' && key === 'me')
      return json({ wallet, ...(await service.dashboard(wallet)) });
    if (method === 'POST' && key === 'auth/logout') {
      const value = req.headers
        .get('cookie')
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('attendback_session='))
        ?.slice(19);
      if (value)
        await pool.query('delete from auth_sessions where token_hash=$1', [
          sha256(value),
        ]);
      return json({ loggedOut: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (
      method === 'POST' &&
      parts[0] === 'sessions' &&
      parts[2] === 'publish'
    ) {
      const b = z
        .object({ version: z.union([z.literal(0), z.literal(1)]) })
        .parse(await body(req));
      return json(
        await chainService.preparePublication(
          wallet,
          uuid.parse(parts[1]),
          b.version,
        ),
      );
    }
    if (method === 'POST' && parts[0] === 'sessions' && parts[2] === 'sync')
      return json(await chainService.syncPublication(uuid.parse(parts[1])));
    if (method === 'POST' && parts[0] === 'events' && parts[2] === 'cancel') {
      const b = z
        .object({ version: z.union([z.literal(0), z.literal(1)]) })
        .parse(await body(req));
      return json(
        await chainService.prepareEventCancel(
          wallet,
          uuid.parse(parts[1]),
          b.version,
        ),
      );
    }
    if (
      method === 'POST' &&
      parts[0] === 'registrations' &&
      parts[2] === 'transaction'
    ) {
      const b = z
        .object({
          action: z.enum([
            'deposit',
            'cancel',
            'settle',
            'timeout',
            'dispute',
            'resolve_refund',
            'resolve_forfeit',
          ]),
          version: z.union([z.literal(0), z.literal(1)]),
        })
        .parse(await body(req));
      const id = uuid.parse(parts[1]);
      return json(
        b.action === 'deposit'
          ? await chainService.prepareDeposit(wallet, id, b.version)
          : await chainService.prepareAction(wallet, id, b.action, b.version),
      );
    }
    if (
      method === 'POST' &&
      parts[0] === 'transactions' &&
      parts[2] === 'submit'
    ) {
      const b = z
        .object({ transaction: z.string().min(100).max(8192) })
        .parse(await body(req));
      return json(
        await chainService.submitIntent(
          wallet,
          uuid.parse(parts[1]),
          b.transaction,
        ),
        202,
      );
    }
    if (method === 'GET' && parts[0] === 'transactions')
      return json(
        await chainService.intentStatus(wallet, uuid.parse(parts[1])),
      );
    if (method === 'POST' && key === 'organizations') {
      const b = z
        .object({ name: z.string().trim().min(2).max(140) })
        .parse(await body(req));
      return json(await service.createOrganization(wallet, b.name), 201);
    }
    if (method === 'POST' && key === 'members') {
      const b = z
        .object({
          orgId: uuid,
          wallet: walletSchema,
          role: z.enum(['manager', 'staff', 'resolver']),
        })
        .parse(await body(req));
      return json(await service.addMember(wallet, b.orgId, b.wallet, b.role));
    }
    if (method === 'POST' && key === 'events') {
      const b = z
        .object({ orgId: uuid, session: z.unknown() })
        .parse(await body(req));
      return json(await service.createEvent(wallet, b.orgId, b.session), 201);
    }
    if (method === 'POST' && key === 'sessions') {
      const b = z
        .object({ eventId: uuid, session: z.unknown() })
        .parse(await body(req));
      return json(await service.addSession(wallet, b.eventId, b.session), 201);
    }
    if (
      method === 'GET' &&
      parts[0] === 'events' &&
      parts[2] === 'registrations'
    )
      return json(
        await service.eventRegistrations(wallet, uuid.parse(parts[1])),
      );
    if (
      method === 'POST' &&
      parts[0] === 'sessions' &&
      parts[2] === 'register'
    ) {
      return json(await service.reserve(wallet, uuid.parse(parts[1])), 201);
    }
    if (parts[0] === 'registrations') {
      const id = uuid.parse(parts[1]);
      if (method === 'GET' && parts.length === 2)
        return json(await service.registration(id, wallet));
      if (method === 'POST' && parts[2] === 'ticket')
        return json(await service.ticket(id, wallet));
    }
    if (method === 'POST' && key === 'checkins') {
      const b = z
        .object({ eventId: uuid, token: z.string().min(40).max(150) })
        .parse(await body(req));
      return json(await service.checkin(wallet, b.eventId, b.token));
    }
    if (method === 'POST' && parts[0] === 'checkins' && parts[2] === 'correct')
      return json(await service.correctCheckin(wallet, uuid.parse(parts[1])));
    if (method === 'POST' && key === 'disputes') {
      const b = z
        .object({
          registrationId: uuid,
          description: z.string().min(10).max(4000),
        })
        .parse(await body(req));
      return json(
        await service.saveDispute(wallet, b.registrationId, b.description),
      );
    }
    if (
      method === 'POST' &&
      parts[0] === 'disputes' &&
      parts[2] === 'evidence'
    ) {
      const b = z
        .object({
          mediaType: z.string().max(80),
          base64: z.string().max(2_796_204),
        })
        .parse(await body(req, 2_800_000));
      return json(
        await service.saveEvidence(
          wallet,
          uuid.parse(parts[1]),
          b.mediaType,
          Buffer.from(b.base64, 'base64'),
        ),
        201,
      );
    }
    if (method === 'GET' && parts[0] === 'evidence') {
      const e = await service.readEvidence(wallet, uuid.parse(parts[1]));
      return new Response(new Uint8Array(e.content), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="evidence-${e.id}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }
    if (method === 'GET' && key === 'ledger') {
      return json(
        (
          await pool.query(
            `select l.*,s.title from ledger l join registrations r on r.id=l.registration_id join sessions s on s.id=r.session_id join events e on e.id=s.event_id where r.wallet=$1 or exists(select 1 from memberships m where m.org_id=e.org_id and m.wallet=$1 and m.role in ('owner','manager')) order by l.finalized_at desc limit 200`,
            [wallet],
          )
        ).rows,
      );
    }
    if (method === 'GET' && key === 'jobs') {
      return json(
        (
          await pool.query(
            `select j.id,j.kind,j.status,j.error_code,j.attempts,j.updated_at from outbox j join registrations r on r.id=j.registration_id join sessions s on s.id=r.session_id join events e on e.id=s.event_id join memberships m on m.org_id=e.org_id where m.wallet=$1 and m.role in ('owner','manager') and j.status<>'done' order by j.created_at limit 200`,
            [wallet],
          )
        ).rows,
      );
    }
    throw new DomainError('NOT_FOUND', 'Маршрут не найден', 404);
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          code: 'VALIDATION',
          message: 'Проверьте поля формы',
          issues: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        400,
      );
    if (error instanceof DomainError)
      return json({ code: error.code, message: error.message }, error.status);
    if (error instanceof Error && 'code' in error && error.code === '23505')
      return json({ code: 'CONFLICT', message: 'Запись уже существует' }, 409);
    console.error(
      'AttendBack request failed:',
      error instanceof Error ? error.name : 'unknown',
    );
    return json(
      {
        code: 'UNAVAILABLE',
        message: 'Сервис временно недоступен. Повторите запрос.',
      },
      503,
    );
  }
}
