import { health } from '../../../../../packages/db/src/index';
export async function GET() {
  try {
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
