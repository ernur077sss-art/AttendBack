import {
  createHash,
  randomBytes,
  randomUUID,
  createPublicKey,
  verify,
} from 'node:crypto';
import { address, getAddressEncoder } from '@solana/kit';
import { pool, transaction, type DbClient } from '../../db/src/index';
import { DomainError, type Role } from '../../domain/src/index';
export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const appOrigin = () =>
  process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
export async function requireRole(
  orgId: string,
  wallet: string,
  roles: Role[],
  db: DbClient = pool,
) {
  const r = await db.query(
    'select role from memberships where org_id=$1 and wallet=$2',
    [orgId, wallet],
  );
  if (!r.rowCount || !roles.includes(r.rows[0].role))
    throw new DomainError('FORBIDDEN', 'Недостаточно прав', 403);
  return r.rows[0].role as Role;
}
export async function rateLimit(
  key: string,
  limit: number,
  db: DbClient = pool,
) {
  const r = await db.query(
    `insert into rate_limits(key,window_start,count) values($1,now(),1) on conflict(key) do update set count=case when rate_limits.window_start<now()-interval '15 minutes' then 1 else rate_limits.count+1 end,window_start=case when rate_limits.window_start<now()-interval '15 minutes' then now() else rate_limits.window_start end returning count`,
    [key],
  );
  if (r.rows[0].count > limit)
    throw new DomainError(
      'RATE_LIMITED',
      'Слишком много запросов; попробуйте позже',
      429,
    );
}
export async function challenge(wallet: string) {
  address(wallet);
  await rateLimit(`auth:${wallet}`, 10);
  const id = randomUUID(),
    nonce = randomBytes(24).toString('hex'),
    expires = new Date(Date.now() + 300_000);
  const message = `${new URL(appOrigin()).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to AttendBack. This does not authorize transactions.\n\nURI: ${appOrigin()}\nVersion: 1\nChain ID: solana:${process.env.SOLANA_CLUSTER ?? 'localnet'}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires.toISOString()}`;
  await pool.query(
    'insert into auth_challenges(id,wallet,message,expires_at) values($1,$2,$3,$4)',
    [id, wallet, message, expires],
  );
  return { id, message, expiresAt: expires.toISOString() };
}
export async function verifyChallenge(id: string, signatureBase64: string) {
  return transaction(async (db) => {
    const r = await db.query(
      'select * from auth_challenges where id=$1 for update',
      [id],
    );
    const c = r.rows[0];
    if (!c || c.consumed_at || new Date(c.expires_at).getTime() <= Date.now())
      throw new DomainError(
        'CHALLENGE_EXPIRED',
        'Вход истёк; запросите новую подпись',
        401,
      );
    const signature = Buffer.from(signatureBase64, 'base64');
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(getAddressEncoder().encode(address(c.wallet))),
      ]),
      format: 'der',
      type: 'spki',
    });
    if (
      signature.length !== 64 ||
      !verify(null, Buffer.from(c.message), publicKey, signature)
    )
      throw new DomainError(
        'INVALID_SIGNATURE',
        'Подпись не прошла проверку',
        401,
      );
    const token = randomBytes(32).toString('base64url');
    await db.query('update auth_challenges set consumed_at=now() where id=$1', [
      id,
    ]);
    await db.query(
      "insert into auth_sessions(token_hash,wallet,expires_at) values($1,$2,now()+interval '1 day')",
      [sha256(token), c.wallet],
    );
    return { token, wallet: c.wallet };
  });
}
export async function authenticatedWallet(req: Request) {
  const token = req.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('attendback_session='))
    ?.slice(19);
  if (!token)
    throw new DomainError(
      'UNAUTHENTICATED',
      'Подключите кошелёк и войдите',
      401,
    );
  const r = await pool.query(
    'select wallet from auth_sessions where token_hash=$1 and expires_at>now()',
    [sha256(token)],
  );
  if (!r.rowCount)
    throw new DomainError('UNAUTHENTICATED', 'Войдите снова', 401);
  return r.rows[0].wallet as string;
}
export function cookie(token: string, maxAge = 86400) {
  return `attendback_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
export function checkOrigin(req: Request) {
  if (req.headers.get('origin') !== appOrigin())
    throw new DomainError(
      'ORIGIN',
      'Запрос должен исходить из AttendBack',
      403,
    );
}
