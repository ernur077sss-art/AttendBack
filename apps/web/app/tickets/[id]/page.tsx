'use client';
import { useI18n } from '../../../../../packages/i18n/react';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../../../components/providers';
import {
  AuthGate,
  PageTitle,
  Status,
  Terms,
  LoadState,
  useResource,
  useChainClock,
} from '../../../components/common';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { api, to64, type Registration } from '../../../lib/api';
export default function Ticket() {
  return (
    <AuthGate>
      <TicketContent />
    </AuthGate>
  );
}
function TicketContent() {
  const { t, date, message } = useI18n();

  const { id } = useParams<{ id: string }>(),
    app = useApp(),
    r = useResource<Registration>(`registrations/${id}`),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(''),
    [token, setToken] = useState(''),
    [expires, setExpires] = useState(''),
    [description, setDescription] = useState(''),
    chainNow = useChainClock(),
    now = chainNow ?? 0,
    [error, setError] = useState('');
  useEffect(() => {
    const t = setInterval(() => void r.reload(), 7000);
    return () => clearInterval(t);
  }, [r.reload]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await r.reload();
      await app.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (action: string) =>
    run(() => app.transact(`registrations/${id}/transaction`, { action }));
  const getQr = () =>
    run(async () => {
      const t = await api<{ token: string; expiresAt: string }>(
        `registrations/${id}/ticket`,
        {},
      );
      setToken(t.token);
      setExpires(t.expiresAt);
      setQr(
        await QRCode.toDataURL(t.token, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      );
    });
  const row = r.data,
    p = row?.policy,
    disabled = busy || app.busy || chainNow === null;
  return (
    <div className="page">
      <LoadState {...r} retry={r.reload} />
      {chainNow === null && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {t(
            'Уточняем время сети. Денежные действия доступны после ответа RPC.',
          )}
        </p>
      )}
      {row && p && (
        <>
          <PageTitle
            overline={t('Мой билет')}
            title={row.title}
            description={`${row.location} · ${date(p.checkinOpen)}`}
            action={
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  void run(() => api(`registrations/${id}/sync`, {}))
                }
              >
                {t('Проверить в сети')}
              </Button>
            }
          />
          {error && (
            <p className="panel border-destructive mb-5" role="alert">
              {message(error)}
            </p>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="stack self-start">
              <div className="panel">
                <div className="flex flex-wrap gap-2 mb-6">
                  <Status value={row.seat_state} />
                  <Status value={row.deposit_state} />
                </div>
                {row.seat_state === 'Waitlisted' && (
                  <p>
                    {t(
                      'Вы в очереди. Когда место освободится, появится предложение на 10 минут. Залог пока не нужен.',
                    )}
                  </p>
                )}
                {['Reserved', 'Offered', 'PaymentPending'].includes(
                  row.seat_state,
                ) && (
                  <>
                    <h2 className="text-xl font-semibold mb-3">
                      {t('Подтвердите место залогом')}
                    </h2>
                    <p className="mb-5 text-muted-foreground">
                      {row.reserved_until &&
                        t('Резерв до {0}. ', [date(row.reserved_until)])}
                      {row.seat_state === 'PaymentPending'
                        ? t(
                            'Сначала проверьте предыдущую операцию в меню кошелька. Новый запрос использует тот же депозит.',
                          )
                        : t(
                            'Условия показаны справа. Подпись потребуется в кошельке.',
                          )}
                    </p>
                    <Button
                      disabled={disabled || now >= p.bookingClose}
                      onClick={() => void act('deposit')}
                    >
                      {t('Внести залог')}
                    </Button>
                  </>
                )}
                {row.seat_state === 'Active' &&
                  !row.late_cancel &&
                  !row.cancelled && (
                    <>
                      <h2 className="text-xl font-semibold mb-3">
                        {t('Ваш билет готов')}
                      </h2>
                      <p className="text-sm text-muted-foreground mb-5">
                        {t(
                          'Покажите свежий QR сотруднику. Код действует 2 минуты. Не передавайте его посторонним.',
                        )}
                      </p>
                      {qr && Date.now() < new Date(expires).getTime() ? (
                        <div className="text-center">
                          <img
                            src={qr}
                            width={280}
                            height={280}
                            alt={t('QR-код билета для сотрудника')}
                            className="mx-auto max-w-full"
                          />
                          <p className="text-xs text-muted-foreground mb-3">
                            {t('До {0}', [date(expires)])}
                          </p>
                          <details className="my-4 text-left">
                            <summary className="cursor-pointer min-h-10 py-2 text-sm">
                              {t('Код для ручного ввода')}
                            </summary>
                            <code
                              data-testid="ticket-token"
                              className="break-all text-xs"
                            >
                              {token}
                            </code>
                          </details>
                        </div>
                      ) : (
                        qr && (
                          <p className="mb-4">
                            {t('QR истёк. Получите новый код.')}
                          </p>
                        )
                      )}
                      <Button
                        disabled={disabled || now >= p.checkinClose}
                        onClick={() => void getQr()}
                      >
                        {qr ? t('Обновить QR') : t('Показать QR')}
                      </Button>
                    </>
                  )}
                {row.deposit_state === 'Settled' && (
                  <p className="mt-5">
                    {t('Расчёт подтверждён сетью. Суммы и подпись перевода —')}{' '}
                    <Link href="/ledger" className="link">
                      {t('в реестре')}
                    </Link>
                    .
                  </p>
                )}
                {row.deposit_address && (
                  <details className="mt-6 text-xs">
                    <summary className="cursor-pointer min-h-10 py-2">
                      {t('Адрес депозита для резервного возврата')}
                    </summary>
                    <code className="break-all">{row.deposit_address}</code>
                  </details>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  {!row.deposit_address &&
                    ['Waitlisted', 'Reserved', 'Offered'].includes(
                      row.seat_state,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          void run(() => api(`registrations/${id}/leave`, {}))
                        }
                      >
                        {t('Освободить место')}
                      </Button>
                    )}
                  {row.deposit_state === 'Funded' &&
                    row.seat_state === 'Active' && (
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void act('cancel')}
                      >
                        {now < p.freeCancelUntil
                          ? t('Отменить с возвратом')
                          : t('Отменить участие')}
                      </Button>
                    )}
                  {row.deposit_state &&
                    row.deposit_state !== 'Settled' &&
                    (row.deposit_state === 'Refundable' ||
                      row.cancelled ||
                      now >= p.hardRefundAt ||
                      (['Forfeitable', 'NoShowProposed'].includes(
                        row.deposit_state,
                      ) &&
                        now >= p.disputeDeadline)) && (
                      <Button
                        disabled={disabled}
                        onClick={() =>
                          void act(now >= p.hardRefundAt ? 'timeout' : 'settle')
                        }
                      >
                        {t('Получить расчёт')}
                      </Button>
                    )}
                </div>
                {row.late_cancel && (
                  <p className="mt-5 text-sm">
                    {t(
                      'Поздняя отмена освободила билет. Расчёт залога пройдёт по условиям неявки после окна спора.',
                    )}
                  </p>
                )}
              </div>
              {row.deposit_state &&
                ['Funded', 'NoShowProposed', 'Disputed'].includes(
                  row.deposit_state,
                ) &&
                now >= p.checkinClose &&
                now < p.disputeDeadline && (
                  <form
                    className="panel stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await api('disputes', {
                          registrationId: id,
                          description,
                        });
                        if (row.deposit_state !== 'Disputed')
                          await app.transact(
                            `registrations/${id}/transaction`,
                            { action: 'dispute' },
                          );
                        app.report(
                          'Описание сохранено. Статус спора проверяется по сети.',
                        );
                      });
                    }}
                  >
                    <h2 className="text-xl font-semibold">
                      {t('Оспорить неявку')}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        'Описание хранится приватно. Удержание останавливает именно подтверждённая транзакция спора, а не сохранение текста.',
                      )}
                    </p>
                    <label className="field">
                      {t('Что произошло')}
                      <Textarea
                        required
                        minLength={10}
                        maxLength={4000}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                    <Button disabled={disabled}>
                      {t('Сохранить и открыть спор')}
                    </Button>
                    <label className="field text-sm">
                      {t('Доказательство · TXT, PNG, JPG или PDF, до 2 MiB')}
                      <input
                        type="file"
                        accept="text/plain,image/png,image/jpeg,application/pdf"
                        disabled={disabled}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void run(async () => {
                              if (f.size > 2097152)
                                throw new Error('Файл больше 2 MiB');
                              await api('disputes', {
                                registrationId: id,
                                description,
                              });
                              await api(`disputes/${id}/evidence`, {
                                mediaType: f.type,
                                base64: to64(
                                  new Uint8Array(await f.arrayBuffer()),
                                ),
                              });
                              app.report('Материал сохранён для арбитра.');
                            });
                        }}
                      />
                    </label>
                  </form>
                )}
            </div>
            <Terms policy={p} />
          </div>
        </>
      )}
    </div>
  );
}
