'use client';
import { useI18n } from '../../../../packages/i18n/react';

import Link from 'next/link';
import { useApp } from '../../components/providers';
import { AuthGate, PageTitle, Empty, Status } from '../../components/common';
import { Button } from '../../components/ui/button';
import { displayAmount } from '../../../../packages/domain/src';
export default function Tickets() {
  const { t, date, message } = useI18n();

  const app = useApp();
  return (
    <AuthGate>
      <div className="page">
        <PageTitle
          title={t('Мои билеты')}
          description={t('Место, вход и залог — каждый статус отдельно.')}
          action={
            <Button variant="outline" onClick={() => void app.refresh()}>
              {t('Обновить')}
            </Button>
          }
        />
        {!app.me?.registrations.length && (
          <Empty title={t('Вы ещё не выбрали событие')}>
            <Link href="/" className="link">
              {t('Посмотреть события')}
            </Link>
          </Empty>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          {app.me?.registrations.map((r) => (
            <article className="panel" key={r.id}>
              <div className="flex flex-wrap gap-2 mb-4">
                <Status value={r.seat_state} />
                <Status value={r.deposit_state} />
              </div>
              <h2 className="text-xl font-semibold">
                <Link className="hover:underline" href={`/tickets/${r.id}`}>
                  {r.title}
                </Link>
              </h2>
              <p className="mt-2 mb-5 text-sm text-muted-foreground">
                {date(r.policy.checkinOpen)} · {r.location}
              </p>
              <div className="flex justify-between gap-3 border-t pt-4">
                <span>
                  {t('{0} USDC · тест', [displayAmount(r.policy.amount)])}
                </span>
                <Link href={`/tickets/${r.id}`} className="link">
                  {t('Открыть билет')}
                </Link>
              </div>
            </article>
          ))}
        </div>
        {!!app.me?.notifications.length && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold mb-4">{t('Уведомления')}</h2>
            <div className="panel divide-y">
              {app.me.notifications.map((n) => (
                <div key={n.id} className="py-3">
                  <p>{message(n.message)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {date(n.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AuthGate>
  );
}
