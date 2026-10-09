import { test, expect, type Page } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { seedDemo, sendLocal } from '../../scripts/demo';
import { localSigner, chainTime } from '../../packages/server/src/chain';
import { reserve } from '../../packages/server/src/service';
import { prepareDeposit } from '../../packages/server/src/chain-service';
import { pool } from '../../packages/db/src';
let eventId: string, eventTitle: string;
test.beforeAll(async () => {
  eventTitle = `Browser meetup ${Date.now()} (демо)`;
  eventId = (await seedDemo(eventTitle)).id;
});
test('organizer creates a draft and publishes immutable policy from the UI', async ({
  browser,
}) => {
  const context = await browser.newContext({
      recordVideo: {
        dir: '.local/demo-video',
        size: { width: 1280, height: 900 },
      },
    }),
    page = await context.newPage();
  await login(page, 'Организатор');
  await page.goto('/organizer');
  const orgForm = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Организация', exact: true }),
  });
  const organizationName = `Demo Team ${Date.now()}`;
  await orgForm.getByLabel('Название', { exact: true }).fill(organizationName);
  await orgForm.getByRole('button', { name: 'Создать организацию' }).click();
  await expect(
    page.getByLabel('Рабочая организация').locator('option:checked'),
  ).toHaveText(organizationName);
  const eventForm = page.locator('form').filter({
    has: page.getByRole('heading', { name: 'Новое событие', exact: true }),
  });
  await expect(eventForm).toBeVisible();
  const title = `Митап сообщества ${Date.now()} (демо)`;
  await eventForm.getByLabel('Название', { exact: true }).fill(title);
  await eventForm
    .getByLabel('Описание', { exact: true })
    .fill('Демонстрационное событие AttendBack. Все суммы тестовые.');
  await eventForm
    .getByLabel('Место проведения', { exact: true })
    .fill('Астана · демоплощадка');
  await eventForm.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page).toHaveURL(/organizer\/events\//);
  await page.getByRole('button', { name: 'Опубликовать в Solana' }).click();
  await page.getByRole('button', { name: 'Подписать транзакцию' }).click();
  await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('link', { name: 'Публичная страница' }).click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }).first(),
  ).toBeVisible();
  await context.close();
  await page.video()?.saveAs('.local/demo-video/organizer.webm');
});
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
  // Durable cloud wakes batch chain checks every 15 seconds instead of running a continuous worker.
  if (process.env.RECONCILIATION_MODE === 'workflow') test.setTimeout(130000);
  const guestContext = await browser.newContext({
      recordVideo: {
        dir: '.local/demo-video',
        size: { width: 1280, height: 900 },
      },
    }),
    staffContext = await browser.newContext({ permissions: ['camera'] });
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
  const matrix = QRCode.create(token, { errorCorrectionLevel: 'M' }).modules,
    side = 400,
    scale = Math.floor(side / (matrix.size + 8)),
    offset = Math.floor((side - matrix.size * scale) / 2),
    pixels = Buffer.alloc(side * side, 235);
  for (let y = 0; y < matrix.size; y++)
    for (let x = 0; x < matrix.size; x++)
      if (matrix.get(y, x))
        for (let dy = 0; dy < scale; dy++)
          pixels.fill(
            16,
            (offset + y * scale + dy) * side + offset + x * scale,
            (offset + y * scale + dy) * side + offset + (x + 1) * scale,
          );
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/camera.y4m',
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${side} H${side} F30:1 Ip A1:1 C420\nFRAME\n`),
      pixels,
      Buffer.alloc((side * side) / 2, 128),
    ]),
  );
  const ticketUrl = guest.url();
  await login(staff, 'Сотрудник');
  await staff.goto('/checkin');
  await staff.getByLabel('Событие', { exact: true }).selectOption(eventId);
  await staff.getByRole('button', { name: 'Сканировать камерой' }).click();
  await expect(staff.getByLabel('Код билета')).toHaveValue(token);
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
      {
        timeout: process.env.RECONCILIATION_MODE === 'workflow' ? 95000 : 50000,
      },
    )
    .toBe('Settled');
  await guest.goto(ticketUrl);
  await expect(guest.getByText('Билет активен', { exact: true })).toBeVisible();
  await guest.goto('/ledger');
  await expect(
    guest
      .getByRole('row')
      .filter({ hasText: eventTitle })
      .getByRole('cell', { name: '5 USDC', exact: true }),
  ).toBeVisible();
  await staff.goto(`/organizer/events/${eventId}`);
  const history = staff.locator('section').filter({
    has: staff.getByRole('heading', { name: 'Журнал входа', exact: true }),
  });
  await expect(
    history.getByRole('cell', { name: 'Вход подтверждён · №1', exact: true }),
  ).toHaveCount(1);
  await expect(history.getByRole('row')).toHaveCount(2);
  expect(errors).toEqual([]);
  await guestContext.close();
  await guest.video()?.saveAs('.local/demo-video/attendance.webm');
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
test('early cancellation refunds the guest and offers the next seat without charging the queue', async ({
  browser,
}) => {
  const event = await seedDemo(
    `Cancellation ${Date.now()} (демо)`,
    'cancel',
    1,
  );
  const guestSigner = await localSigner('guest'),
    r = await reserve(guestSigner.address, event.sessionId);
  await sendLocal(
    guestSigner,
    await prepareDeposit(guestSigner.address, r.id, 0),
  );
  const firstContext = await browser.newContext(),
    secondContext = await browser.newContext(),
    first = await firstContext.newPage(),
    second = await secondContext.newPage();
  await login(first, 'Участник');
  await first.goto(`/tickets/${r.id}`);
  await login(second, 'Участник 2');
  await second.goto(`/events/${event.id}`);
  await second.getByRole('checkbox').check();
  await second.getByRole('button', { name: 'Забронировать место' }).click();
  await expect(
    second.getByText('В листе ожидания', { exact: true }),
  ).toBeVisible();
  const secondId = second.url().split('/').pop()!;
  await first.getByRole('button', { name: 'Отменить с возвратом' }).click();
  await first.getByRole('button', { name: 'Подписать транзакцию' }).click();
  await expect(
    first.getByText('Место освобождено', { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      async () => {
        const row = await (
          await second.request.get(`/api/registrations/${secondId}`)
        ).json();
        return { seat: row.seat_state, deposit: row.deposit_state };
      },
      { timeout: 30000 },
    )
    .toEqual({ seat: 'Offered', deposit: null });
  await expect
    .poll(
      async () => {
        return (
          await (await first.request.get(`/api/registrations/${r.id}`)).json()
        ).deposit_state;
      },
      { timeout: 30000 },
    )
    .toBe('Settled');
  await firstContext.close();
  await secondContext.close();
});
test('guest opens a dispute, uploads private evidence, assigned resolver grants a finalized refund', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const n = await chainTime(),
    event = await seedDemo(`Dispute ${Date.now()} (демо)`, 'attendance', 5, {
      bookingClose: n + 35,
      checkinClose: n + 40,
      proposalCutoff: n + 50,
      disputeDeadline: n + 150,
      resolutionDeadline: n + 200,
      hardRefundAt: n + 250,
    });
  const signer = await localSigner('guest'),
    r = await reserve(signer.address, event.sessionId);
  await sendLocal(signer, await prepareDeposit(signer.address, r.id, 0));
  const guestContext = await browser.newContext(),
    resolverContext = await browser.newContext(),
    guest = await guestContext.newPage(),
    resolver = await resolverContext.newPage();
  await login(guest, 'Участник');
  await guest.goto(`/tickets/${r.id}`);
  await expect(
    guest.getByRole('heading', { name: 'Оспорить неявку' }),
  ).toBeVisible({ timeout: 50000 });
  await guest
    .getByLabel('Что произошло')
    .fill(
      'Я был на площадке, но сотрудник не отметил мой билет. Прошу проверить журнал входа.',
    );
  await guest.getByRole('button', { name: 'Сохранить и открыть спор' }).click();
  await guest.getByRole('button', { name: 'Подписать транзакцию' }).click();
  await expect(guest.getByText('Спор открыт', { exact: true })).toBeVisible({
    timeout: 25000,
  });
  await guest.locator('input[type=file]').setInputFiles({
    name: 'proof.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic local evidence of attendance'),
  });
  await expect(guest.getByText('Материал сохранён для арбитра.')).toBeVisible();
  await login(resolver, 'Арбитр');
  await resolver.goto('/disputes');
  await resolver.getByLabel('Событие', { exact: true }).selectOption(event.id);
  await expect(resolver.getByText(/Я был на площадке/)).toBeVisible();
  await expect(
    resolver.getByRole('link', { name: /Материал 1/ }),
  ).toBeVisible();
  await resolver
    .getByRole('button', { name: 'Вернуть залог', exact: true })
    .click();
  await resolver.getByRole('button', { name: 'Подписать транзакцию' }).click();
  await expect
    .poll(
      async () => {
        return (
          await (await guest.request.get(`/api/registrations/${r.id}`)).json()
        ).deposit_state;
      },
      { timeout: 35000 },
    )
    .toBe('Settled');
  await guestContext.close();
  await resolverContext.close();
});
