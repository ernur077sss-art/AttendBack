import { handle } from '../../../../../packages/server/src/http';
import { after } from 'next/server';
import { start } from 'workflow/api';
import { reconcileWorkflow } from '../../../workflows/reconciliation';
import { wakeExistingWorker } from '../../../lib/wake-worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const GET = handle;
export async function POST(request: Request) {
  const response = await handle(request);
  if (
    process.env.RECONCILIATION_MODE === 'workflow' &&
    response.ok &&
    !new URL(request.url).pathname.startsWith('/api/auth/')
  ) {
    after(async () => {
      try {
        if (!(await wakeExistingWorker())) await start(reconcileWorkflow);
      } catch {
        // DB outbox remains durable. The daily watchdog and next write retry dispatch.
        console.error('Reconciliation dispatch failed; durable jobs retained');
      }
    });
  }
  return response;
}
