import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  localSigner,
  chainTime,
  prepare,
  broadcast,
  signatureStatus,
} from '../../packages/server/src/chain';
import * as p from '../../packages/chain-client/src';
test('independent recovery refunds a cancelled event with AttendBack API blocked', async ({
  page,
}) => {
  const owner = await localSigner('owner'),
    guest = await localSigner('guest2'),
    booking = await localSigner('booking'),
    mint = (await localSigner('mint')).address,
    n = await chainTime();
  const eventId = p.idBytes(randomUUID()),
    policyId = p.idBytes(randomUUID()),
    event = await p.eventPda(owner.address, eventId),
    policy = await p.policyPda(event, policyId),
    commitment = await p.commitmentPda(policy, guest.address);
  const send = async (
    instructions: Parameters<typeof prepare>[1],
    payer = owner,
  ) => {
    const tx = await prepare(payer, instructions, 1),
      sig = await broadcast(tx.wire);
    for (let i = 0; i < 100; i++) {
      const s = await signatureStatus(sig);
      if (s?.err) throw new Error('Fixture transaction failed');
      if (s?.confirmationStatus === 'finalized') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Fixture timed out');
  };
  const terms = {
    amount: 3000000n,
    penaltyBps: 5000,
    bookingAuthority: booking.address,
    attester: owner.address,
    resolver: owner.address,
    penaltyRecipient: owner.address,
    bookingClose: n + 400,
    freeCancelUntil: n - 10,
    checkinOpen: n,
    checkinClose: n + 500,
    proposalCutoff: n + 600,
    disputeDeadline: n + 700,
    resolutionDeadline: n + 800,
    hardRefundAt: n + 900,
    termsHash: new Uint8Array(32),
  };
  await send([
    p.getCreateEventInstruction({
      authority: owner,
      event,
      id: eventId,
      cancelDeadline: n + 700,
    }),
    p.getPublishPolicyInstruction({
      authority: owner,
      event,
      policy,
      mint,
      id: policyId,
      terms,
    }),
  ]);
  const source = (
    await findAssociatedTokenPda({
      owner: guest.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];
  await send(
    [
      p.getDepositInstruction({
        guest,
        bookingAuthority: booking,
        event,
        policy,
        commitment,
        vault: await p.vaultPda(commitment),
        source,
        mint,
        permitExpires: n + 300,
      }),
    ],
    guest,
  );
  await send([p.getCancelEventInstruction({ authority: owner, event })]);
  const apiRequests: string[] = [];
  await page.route('http://127.0.0.1:3000/**', (route) => {
    apiRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Адрес депозита', { exact: true }).fill(commitment);
  await page
    .getByRole('button', { name: 'Проверить депозит', exact: true })
    .click();
  await expect(
    page.getByText('Полный возврат доступен.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Тест · Участник 2', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Подготовить возврат', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Подтвердите возврат' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Подписать возврат', exact: true })
    .click();
  await expect(
    page.getByText('Возврат отправлен. Проверьте подтверждение сети.'),
  ).toBeVisible();
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Проверить подтверждение', exact: true })
      .click();
    await expect(
      page.getByText(/Возврат подтверждён \(finalized\)/),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000, intervals: [1000] });
  expect(apiRequests).toEqual([]);
});
