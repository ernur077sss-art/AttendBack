import { createHook, sleep, RetryableError } from 'workflow';
import { start } from 'workflow/api';
import { randomUUID } from 'node:crypto';
import { tick } from '../../../packages/server/src/jobs';
import { nextReconciliationAt } from '../../../packages/server/src/workflow-schedule';

export const RECONCILIATION_HOOK = 'attendback-reconciliation-v1';

export async function reconciliationStep() {
  'use step';
  console.log(JSON.stringify({ service: 'reconciliation', status: 'started' }));
  try {
    await tick(randomUUID(), 2, 5);
    const next = await nextReconciliationAt();
    console.log(
      JSON.stringify({
        service: 'reconciliation',
        status: 'sleep',
        until: next.toISOString(),
      }),
    );
    return next;
  } catch {
    throw new RetryableError('Reconciliation unavailable', {
      retryAfter: '2m',
    });
  }
}
reconciliationStep.maxRetries = 5;

export async function reconcileWorkflow() {
  'use workflow';
  // The hook is also a distributed singleton. Duplicate starts do no DB work.
  {
    using wake = createHook<boolean>({ token: RECONCILIATION_HOOK });
    if (await wake.getConflict()) return;
    const iterator = wake[Symbol.asyncIterator]();
    let signal = iterator.next();
    // Rotate long runs well before the event-log limit.
    for (let cycle = 0; cycle < 200; cycle++) {
      const next = await reconciliationStep();
      const awakened = await Promise.race([
        sleep(next).then(() => false),
        signal.then(() => true),
      ]);
      // Keep the pending read when a timer wins, so a wake is never consumed by an abandoned read.
      if (awakened) signal = iterator.next();
    }
  }
  console.log('Reconciliation continuing in a fresh workflow run');
  await start(reconcileWorkflow);
}
