import { createServer } from 'node:http';
import { Readable } from 'node:stream';
export function signerHttpServer(
  handler: (request: Request) => Promise<Response>,
) {
  return createServer(
    { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 5000 },
    async (req, res) => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value)
            headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const request = new Request(`http://127.0.0.1${req.url ?? '/'}`, {
          method: req.method,
          headers,
          ...(!['GET', 'HEAD'].includes(req.method ?? '')
            ? {
                body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
                duplex: 'half',
              }
            : {}),
        });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!res.headersSent)
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
        res.end('{"error":"UNAVAILABLE"}');
      }
    },
  );
}
