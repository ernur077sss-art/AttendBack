import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://attendback:attendback@127.0.0.1:54329/attendback';
const hosted = process.env.VERCEL === '1';
const max = Number(process.env.DATABASE_POOL_MAX ?? (hosted ? 5 : 10));
if (!Number.isInteger(max) || max < 2 || max > 50)
  throw new Error('DATABASE_POOL_MAX must be an integer from 2 to 50');
export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max,
  idleTimeoutMillis: hosted ? 5000 : 10000,
  connectionTimeoutMillis: 10000,
});
if (hosted) attachDatabasePool(pool);
pool.on('error', (error) => {
  // Do not log connection strings or provider errors containing credentials.
  console.error('AttendBack idle database connection failed:', error.name);
});
export async function health() {
  const result = await pool.query('select 1 as ok');
  return result.rows[0].ok === 1;
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export type DbClient = Pick<pg.PoolClient, 'query'>;
