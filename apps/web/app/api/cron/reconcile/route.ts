import { timingSafeEqual, createHash } from 'node:crypto';
import { start } from 'workflow/api';
import { reconcileWorkflow } from '../../../../workflows/reconciliation';
import { wakeExistingWorker } from '../../../../lib/wake-worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const hash = (s: string) => createHash('sha256').update(s).digest();
export async function GET(request: Request) {
  const token = process.env.CRON_SECRET;
  if (
    !token ||
    token.length < 32 ||
    !timingSafeEqual(
      hash(request.headers.get('authorization') ?? ''),
      hash(`Bearer ${token}`),
    )
  )
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (process.env.RECONCILIATION_MODE !== 'workflow')
    return Response.json({ error: 'DISABLED' }, { status: 503 });
  try {
    const resumed = await wakeExistingWorker();
    if (!resumed) await start(reconcileWorkflow);
    return Response.json(
      { scheduled: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ scheduled: false }, { status: 503 });
  }
}
