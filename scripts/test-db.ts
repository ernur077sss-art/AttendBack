import pg from 'pg';
async function main() {
  const url = new URL(
    process.env.DATABASE_URL ??
      'postgresql://attendback:attendback@127.0.0.1:54329/attendback',
  );
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Test database creation only supports localhost');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  if (
    !(
      await client.query(
        "select 1 from pg_database where datname='attendback_test'",
      )
    ).rowCount
  )
    await client.query('create database attendback_test');
  await client.end();
  console.log('attendback_test ready');
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
