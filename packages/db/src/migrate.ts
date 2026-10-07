import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index';
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(87240491)');
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../migrations',
    );
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const exists = await client.query(
        "select to_regclass('public.migrations') as name",
      );
      if (
        exists.rows[0].name &&
        (await client.query('select 1 from migrations where name=$1', [name]))
          .rowCount
      )
        continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(dir, name), 'utf8'));
        await client.query('insert into migrations(name) values($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(87240491)');
    client.release();
  }
}
if (process.argv[1]?.endsWith('/migrate.ts'))
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
      void pool.end();
    });
