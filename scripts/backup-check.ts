import pg from 'pg';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
async function digest(client: pg.Client) {
  const tables = (
    await client.query(
      "select tablename from pg_tables where schemaname='public' order by tablename",
    )
  ).rows.map((r) => r.tablename as string);
  const sum = createHash('sha256');
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table))
      throw new Error('Unexpected table identifier');
    const data = (
      await client.query(
        `select to_jsonb(t) as data from "${table}" t order by to_jsonb(t)::text`,
      )
    ).rows;
    sum.update(JSON.stringify([table, data]));
  }
  return { hash: sum.digest('hex'), tables: tables.length };
}
async function main() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      'postgresql://attendback:attendback@127.0.0.1:54329/attendback_test',
  );
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(
      'Restore verification is limited to a local *_test database',
    );
  const source = new pg.Client({ connectionString: url.toString() });
  await source.connect();
  const dbName = `attendback_restore_${Date.now()}_test`;
  let restored: pg.Client | undefined;
  const bin =
    process.env.PG_BIN ?? path.resolve('.local/toolchain/postgres-client/bin');
  const dir = path.resolve('.local/backups');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const dump = path.join(dir, 'verified-test.dump');
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  try {
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await source.query('select pg_export_snapshot() as id'))
      .rows[0].id;
    const before = await digest(source);
    await exec(
      path.join(bin, 'pg_dump'),
      [
        '--format=custom',
        '--no-owner',
        '--snapshot',
        snapshot,
        '--file',
        dump,
        url.pathname.slice(1),
      ],
      { env },
    );
    await source.query('COMMIT');
    await source.query(`create database "${dbName}"`);
    await exec(
      path.join(bin, 'pg_restore'),
      [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        dbName,
        dump,
      ],
      { env },
    );
    const restoreUrl = new URL(url);
    restoreUrl.pathname = `/${dbName}`;
    restored = new pg.Client({ connectionString: restoreUrl.toString() });
    await restored.connect();
    const after = await digest(restored);
    if (after.hash !== before.hash || after.tables !== before.tables)
      throw new Error('Restored data differs from consistent source snapshot');
    console.log(
      `Backup/restore verified: ${after.tables} tables, schema restored, all row contents match.`,
    );
  } finally {
    await source.query('ROLLBACK').catch(() => {});
    if (restored) await restored.end();
    await source.query(`drop database if exists "${dbName}"`);
    await source.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
