// This informational page must not import keys or call the protected API.
// Opening the service URL is not a signer health check.
export const dynamic = 'force-static';

export function GET() {
  return new Response(
    `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>AttendBack · Signing service</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #fafaf9; color: #1c1917; font: 16px/1.6 system-ui, sans-serif; }
    main { max-width: 680px; margin: 12vh auto; padding: 32px; }
    .brand { font-size: 22px; font-weight: 750; }
    h1 { font-size: clamp(28px, 5vw, 40px); line-height: 1.2; margin: 40px 0 20px; }
    p { color: #57534e; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; margin: 28px 0; }
    a { display: inline-block; padding: 12px 20px; border: 1px solid #292524; border-radius: 8px; color: #292524; font-weight: 650; text-decoration: none; }
    a:first-child { background: #292524; color: white; }
    a:hover { text-decoration: underline; }
    a:focus-visible { outline: 3px solid #2563eb; outline-offset: 4px; }
    section { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e7e5e4; }
    h2 { font-size: 20px; margin: 0; }
    small { color: #78716c; }
  </style>
</head>
<body>
  <main>
    <div class="brand">AttendBack</div>
    <h1>Служебный сервис подписи</h1>
    <p>Этот адрес используется сервером AttendBack. Для мероприятий, билетов и возвратов откройте основное приложение.</p>
    <nav aria-label="Открыть AttendBack / Open AttendBack">
      <a href="https://attendback-three.vercel.app/?lang=ru">Открыть AttendBack</a>
      <a href="https://attendback-three.vercel.app/?lang=en" lang="en">Open in English</a>
    </nav>
    <section lang="en">
      <h2>Signing service</h2>
      <p>This address hosts AttendBack’s server signing API. Open the app to browse events, manage tickets and view refunds.</p>
      <small>The API requires server authentication. This page does not verify service health or request a wallet connection.</small>
    </section>
  </main>
</body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
