import { test, expect } from './fixtures';

test('public demo explains the flow in both languages without creating transactions', async ({
  page,
}) => {
  const mutations: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      mutations.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?lang=ru');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(
    page.getByText(
      'Например, при удержании 20%: 1 USDC получателю, 4 USDC гостю. После окна оспаривания.',
    ),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Посмотреть демо', exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\?lang=ru/);
  await page
    .getByRole('button', { name: 'Показать пример билета', exact: true })
    .click();
  await expect(
    page.getByText('Пример: место подтверждено', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(
    page.getByText('Example: spot confirmed', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Show a sample refund', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Example: deposit refunded', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'This is an educational example without a wallet or payments. It does not create a registration, sign transactions or confirm an actual refund.',
    ),
  ).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(
    page.getByText('Example: terms selected', { exact: true }),
  ).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole('link', { name: 'Create an event', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('landing keeps the demo available when event loading fails and supports retry', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/events', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Сервис временно недоступен. Повторите запрос.',
          }),
        })
      : route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/?lang=en');
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Explore the demo', exact: true }),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Create an event', exact: true }),
  ).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
