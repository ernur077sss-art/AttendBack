import { signerHttpServer } from './http';
import { loadSignerConfig } from './config';
import { createSignerHandler } from './service';
async function main() {
  const config = await loadSignerConfig();
  const handler = createSignerHandler({
    ...config,
    log: (record) =>
      console.log(JSON.stringify({ service: 'signer', ...record })),
  });
  const server = signerHttpServer(handler);
  // The TLS proxy must run on the same host. This service never listens on a public interface.
  server.listen(config.port, '127.0.0.1', () =>
    console.log(
      JSON.stringify({
        service: 'signer',
        cluster: 'devnet',
        port: config.port,
        status: 'ready',
      }),
    ),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      server.close();
      setTimeout(() => server.closeAllConnections(), 15000).unref();
    });
}
main().catch(() => {
  console.error(
    'Signer startup refused. Check devnet configuration, secret permissions, key addresses and deployed program.',
  );
  process.exitCode = 1;
});
