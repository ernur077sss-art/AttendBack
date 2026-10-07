import { health, pool } from '../../../packages/db/src/index';
async function main() {
  if (!(await health())) throw new Error('Database is unavailable');
  console.log('AttendBack worker: database connected');
  if (process.argv.includes('--once')) {
    await pool.end();
    return;
  }
  const timer = setInterval(
    () => void health().catch(console.error),
    Number(process.env.WORKER_POLL_MS ?? 2000),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      clearInterval(timer);
      await pool.end();
      process.exit(0);
    });
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
