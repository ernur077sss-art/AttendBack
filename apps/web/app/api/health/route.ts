import { health } from '../../../../../packages/db/src/index';
import { assertHostedConfiguration } from '../../../../../packages/server/src/deployment';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export async function GET() {
  try {
    assertHostedConfiguration();
    return Response.json({
      service: 'attendback',
      database: await health(),
      cluster: process.env.SOLANA_CLUSTER ?? 'localnet',
    });
  } catch {
    return Response.json(
      { service: 'attendback', database: false },
      { status: 503 },
    );
  }
}
