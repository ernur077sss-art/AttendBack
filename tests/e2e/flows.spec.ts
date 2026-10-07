import { test, expect, type Page } from '@playwright/test';
import { seedDemo } from '../../scripts/demo';
import { pool } from '../../packages/db/src';
let eventId: string;
test.beforeAll(async () => {
  eventId = (await seedDemo(`Browser meetup ${Date.now()} (демо)`)).id;
});
test.afterAll(() => pool.end());
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page
    .getByRole('button', { name: `Тест · ${role}`, exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('guest deposits, staff scans once, finalized refund preserves ticket', async ({
  browser,
}) => {
  const guestContext = await browser.newContext(),
    staffContext = await browser.newContext();
  const guest = await guestContext.newPage(),
    staff = await staffContext.newPage();
  const errors: string[] = [];
  guest.on('pageerror', (e) => errors.push(e.message));
  staff.on('pageerror', (e) => errors.push(e.message));
  await login(guest, 'Участник');
  await guest.goto(`/events/${eventId}`);
  await guest.getByRole('checkbox').check();
  await guest.getByRole('button', { name: 'Забронировать место' }).click();
  await expect(guest).toHaveURL(/tickets\//);
  await guest.getByRole('button', { name: 'Внести залог' }).click();
  await expect(guest.getByRole('dialog')).toBeVisible();
  await guest.getByRole('button', { name: 'Подписать транзакцию' }).click();
  await expect(guest.getByText('Билет активен', { exact: true })).toBeVisible({
    timeout: 35000,
  });
  await guest.getByRole('button', { name: 'Показать QR' }).click();
  await guest.getByText('Код для ручного ввода').click();
  const token = await guest.getByTestId('ticket-token').innerText();
  const ticketUrl = guest.url();
  await login(staff, 'Сотрудник');
  await staff.goto('/checkin');
  await staff.getByLabel('Событие', { exact: true }).selectOption(eventId);
  await staff.getByLabel('Код билета').fill(token);
  await staff.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expect(staff.getByText(/Отметка сохранена/)).toBeVisible();
  await expect(
    staff.getByRole('button', { name: 'Исправить ошибочный вход' }),
  ).toBeEnabled();
  await staff.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expect(staff.getByText(/Этот билет уже отмечен/)).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await guest.request.get(
          `/api/registrations/${token.split('.')[0]}`,
        );
        return (await response.json()).deposit_state;
      },
      { timeout: 50000 },
    )
    .toBe('Settled');
  await guest.goto(ticketUrl);
  await expect(guest.getByText('Билет активен', { exact: true })).toBeVisible();
  await guest.goto('/ledger');
  await expect(
    guest.getByRole('cell', { name: '5 USDC', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await guestContext.close();
  await staffContext.close();
});
test('public pages fit mobile, tablet and desktop and wallet dialog supports Escape', async ({
  page,
}) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Приходите/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
