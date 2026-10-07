import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
async function main() {
  const databaseDir = path.resolve('.local/postgres');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'attendback',
    password: 'attendback',
    port: 54329,
    persistent: true,
    authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1', '-k', path.resolve('.local')],
    onLog: () => {},
    onError: (e) => console.error(String(e)),
  });
  if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient('postgres');
  await client.connect();
  if (
    !(
      await client.query(
        "select 1 from pg_database where datname = 'attendback'",
      )
    ).rowCount
  )
    await client.query('create database attendback');
  await client.end();
  console.log(
    'PostgreSQL ready at 127.0.0.1:54329; database attendback (local development only)',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await pg.stop();
      process.exit(0);
    });
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
