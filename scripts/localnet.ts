import { Surfnet } from '@solana/surfpool';
import { createServer } from 'node:http';
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { none } from '@solana/kit';
import { localSigner, network } from '../packages/server/src/chain';
import { PROGRAM_ADDRESS } from '../packages/chain-client/src/index';
async function main() {
  if (network().cluster !== 'localnet')
    throw new Error('This script only starts localnet');
  const surfnet = Surfnet.startWithConfig({
    offline: true,
    blockProductionMode: 'clock',
    slotTimeMs: 200,
    allFeatures: true,
  });
  surfnet.deploy({
    programId: PROGRAM_ADDRESS,
    soPath: 'target/deploy/attendback.so',
    idlPath: 'idl/attendback.json',
  });
  const mint = (await localSigner('mint')).address;
  surfnet.setAccount(
    mint,
    10_000_000,
    new Uint8Array(
      getMintEncoder().encode({
        mintAuthority: none(),
        supply: 1_000_000_000_000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthority: none(),
      }),
    ),
    TOKEN_PROGRAM_ADDRESS,
  );
  for (const role of [
    'booking',
    'attester',
    'payer',
    'owner',
    'guest',
    'guest2',
    'staff',
    'resolver',
  ]) {
    const account = await localSigner(role);
    surfnet.fundSol(account.address, 10_000_000_000);
    surfnet.fundToken(account.address, mint, 1_000_000_000);
  }
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      const allowed = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
      if (origin && ![allowed, 'http://127.0.0.1:4173'].includes(origin)) {
        res.writeHead(403).end();
        return;
      }
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const result = await fetch(surfnet.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(15000),
      });
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.status).end(await result.text());
    } catch {
      res.writeHead(503).end('{"error":"Local RPC unavailable"}');
    }
  });
  server.listen(8899, '127.0.0.1', () =>
    console.log(
      `AttendBack local Solana RPC: http://127.0.0.1:8899\nProgram: ${PROGRAM_ADDRESS}\nTest mint: ${mint}\nEphemeral chain: restarting resets chain state. Test assets have no value.`,
    ),
  );
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () =>
      server.close(() => {
        surfnet.stop();
        process.exit(0);
      }),
    );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
