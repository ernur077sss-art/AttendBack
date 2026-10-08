import { test, expect } from '@playwright/test';
import { seedDemo } from '../../scripts/demo';
import { pool } from '../../packages/db/src';
test.afterAll(() => pool.end());
test('booking follows Solana time despite device clock drift and disables on clock failure', async ({
  page,
}) => {
  const event = await seedDemo(`Clock regression ${Date.now()} (демо)`);
  let response: 'live' | 'unavailable' | number = 'live';
  await page.route('**/api/clock', (route) => {
    if (response === 'live') return route.continue();
    return route.fulfill({
      status: response === 'unavailable' ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        response === 'unavailable'
          ? { message: 'RPC unavailable' }
          : { unixTime: response },
      ),
    });
  });
  // Solana says registration is open even if the user's device is years ahead.
  await page.clock.setFixedTime(new Date('2099-01-01T00:00:00Z'));
  await page.goto(`/events/${event.id}`);
  await page.getByRole('checkbox').check();
  const booking = page.getByRole('button', { name: 'Забронировать место' });
  await expect(booking).toBeEnabled();
  response = 'unavailable';
  await expect(booking).toBeDisabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'Ожидаем время сети' }),
  ).toBeVisible();
  const data = await (await page.request.get(`/api/events/${event.id}`)).json();
  response = data.sessions[0].policy.bookingClose;
  await page.clock.setFixedTime(new Date('2000-01-01T00:00:00Z'));
  await expect(
    page.getByText('Регистрация закрыта.', { exact: true }),
  ).toBeVisible();
  await expect(booking).toBeDisabled();
  response = 'live';
  await expect(booking).toBeEnabled();
});
