import { test, expect } from './fixtures';

test('language links, navigation, reload and mobile layout preserve the choice', async ({
  page,
}) => {
  await page.goto('/?lang=ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.goto('/?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('heading', { name: 'Show up. Get your deposit back.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'English', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('link', { name: 'Recovery refund', exact: true }),
  ).toHaveAttribute('href', /[?&]lang=en/);
  await page.getByRole('button', { name: 'Русский', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Приходите. Залог вернётся.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible();
  // Navigate in a new page of the same browser context (same saved language).
  const other = await page.context().newPage();
  await other.goto('/');
  await other.reload();
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole('button', { name: 'English', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('switching languages preserves wallet, unsaved event terms, errors and publication flow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?lang=ru');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page
    .getByRole('button', { name: 'Тест · Организатор', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/organizer');
  const orgForm = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Организация', exact: true }),
  });
  const organizationName = `Language test ${Date.now()}`;
  await orgForm.getByLabel('Название', { exact: true }).fill(organizationName);
  await orgForm.getByRole('button', { name: 'Создать организацию' }).click();
  await expect(
    page.getByLabel('Рабочая организация').locator('option:checked'),
  ).toHaveText(organizationName);
  const form = page
    .locator('form')
    .filter({ has: page.locator('input[name="amount"]') });
  await expect(form).toBeVisible();
  const title = `Встреча / Builders ${Date.now()}`;
  await form.locator('[name="title"]').fill(title);
  await form
    .locator('[name="description"]')
    .fill('Авторский текст / Original text');
  await form.locator('[name="location"]').fill('Astana Hub');
  await form.locator('[name="amount"]').fill('1.1234567');
  const deadline = await form.locator('[name="bookingClose"]').inputValue();
  let authRequests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/auth/challenge')) authRequests++;
  });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Organizer dashboard' }),
  ).toBeVisible();
  await expect(form.locator('[name="title"]')).toHaveValue(title);
  await expect(form.locator('[name="bookingClose"]')).toHaveValue(deadline);
  await expect(
    form.getByText('Free cancellation until', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Amount: up to 6 decimal places',
  );
  await page.getByRole('button', { name: 'Русский', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Сумма: до 6 знаков после точки',
  );
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await form.locator('[name="amount"]').fill('1.5');
  await form.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/organizer\/events\//);
  await expect(
    page.getByRole('heading', { name: title, exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish on Solana' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Publish immutable terms',
  );
  await expect(page.getByRole('dialog')).toContainText('1.5 test USDC');
  await expect(page.getByRole('dialog')).toContainText(
    'Network and account storage fees are paid separately from the deposit',
  );
  await page
    .getByRole('button', { name: 'Sign transaction', exact: true })
    .click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(authRequests).toBe(0);
  expect(errors).toEqual([]);
});

test('independent recovery supports language selection without losing the deposit input', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4173/?lang=en');
  await expect(
    page.getByRole('heading', { name: 'Recovery refund', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Deposit address', { exact: true })
    .fill('DepositAddressForLanguageTest');
  await page.getByRole('button', { name: 'Русский', exact: true }).click();
  await expect(page.getByLabel('Адрес депозита', { exact: true })).toHaveValue(
    'DepositAddressForLanguageTest',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.reload();
  await expect(page).toHaveTitle('AttendBack — Recovery refund');
});
