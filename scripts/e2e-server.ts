import pg from 'pg';
import { spawn } from 'node:child_process';
async function main() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/[a-z0-9_]+_test$/.test(target.pathname)
  )
    throw new Error('E2E requires an isolated local *_test database');
  const database = target.pathname.slice(1),
    admin = new URL(target);
  admin.pathname = '/postgres';
  const connection = new pg.Client({ connectionString: admin.toString() });
  await connection.connect();
  if (
    !(
      await connection.query('select 1 from pg_database where datname=$1', [
        database,
      ])
    ).rowCount
  )
    await connection.query(`create database "${database}"`);
  await connection.end();
  const { migrate } = await import('../packages/db/src/migrate');
  await migrate();
  const { pool } = await import('../packages/db/src');
  await pool.end();
  const children = [
    spawn(
      process.execPath,
      [
        '../../node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3001',
      ],
      { stdio: 'inherit', env: process.env, cwd: 'apps/web' },
    ),
    ...(process.env.RECONCILIATION_MODE === 'workflow'
      ? []
      : [
          spawn(
            process.execPath,
            ['--import', 'tsx', 'apps/worker/src/index.ts'],
            {
              stdio: 'ignore',
              env: process.env,
            },
          ),
        ]),
  ];
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  for (const child of children)
    child.on('exit', (code) => {
      if (!stopping) {
        process.exitCode = code ?? 1;
        stop();
      }
    });
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
