import { randomUUID } from 'node:crypto';
import { health, pool } from '../../../packages/db/src/index';
import { tick } from '../../../packages/server/src/jobs';
async function main() {
  if (!(await health())) throw new Error('Database unavailable');
  const workerId = randomUUID();
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopping = true;
    });
  console.log(
    'AttendBack worker: database connected, local/devnet reconciliation enabled',
  );
  do {
    try {
      await tick(workerId);
      console.log(
        JSON.stringify({
          service: 'worker',
          at: new Date().toISOString(),
          status: 'ok',
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          service: 'worker',
          status: 'retry',
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
      if (process.argv.includes('--once')) throw error;
    }
    if (process.argv.includes('--once') || stopping) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.WORKER_POLL_MS ?? 2000)),
    );
  } while (!stopping);
  await pool.end();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  void pool.end();
});
