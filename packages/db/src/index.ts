import pg from 'pg';
export const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://attendback:attendback@127.0.0.1:54329/attendback';
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
export async function health() {
  const result = await pool.query('select 1 as ok');
  return result.rows[0].ok === 1;
}
