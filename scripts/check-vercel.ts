import { validateVercelEnvironment } from '../packages/server/src/deployment';

try {
  validateVercelEnvironment();
  console.log(
    'Vercel configuration validated. No database connections, migrations, signatures or deployments were performed.',
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Invalid Vercel configuration',
  );
  process.exitCode = 1;
}
