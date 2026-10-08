import { test as base } from '@playwright/test';
import { pool } from '../../packages/db/src';

// Playwright can reuse a worker (and its module cache) across spec files.
export const test = base.extend<{}, { databaseLifetime: void }>({
  databaseLifetime: [
    async ({}, use) => {
      await use();
      await pool.end();
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect, type Page } from '@playwright/test';
