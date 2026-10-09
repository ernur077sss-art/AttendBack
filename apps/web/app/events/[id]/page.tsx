'use client';
import { useI18n } from '../../../../../packages/i18n/react';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '../../../components/providers';
import {
  useResource,
  useChainClock,
  PageTitle,
  LoadState,
  Terms,
} from '../../../components/common';
import { Button } from '../../../components/ui/button';
import { api, type Event, type Registration } from '../../../lib/api';
export default function EventPage() {
  const { t, date } = useI18n();

  const { id } = useParams<{ id: string }>(),
    r = useResource<Event>(`events/${id}`),
    app = useApp(),
    chainNow = useChainClock(),
    router = useRouter(),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState<string[]>([]);
  const reserve = async (sid: string) => {
    if (!app.me) {
      app.login();
      return;
    }
    setBusy(true);
    try {
      const reg = await api<Registration>(`sessions/${sid}/register`, {});
      await app.refresh();
      router.push(`/tickets/${reg.id}`);
    } catch (e) {
      app.report((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <LoadState {...r} retry={r.reload} />
      {r.data && (
        <>
          <PageTitle
            overline={r.data.organization}
            title={r.data.title}
            description={r.data.description}
          />
          <p className="mb-8 text-muted-foreground">
            {r.data.location} {r.data.cancelled && t('· Событие отменено')}
          </p>
          <div className="stack">
            {chainNow === null && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('Проверяем доступность регистрации. Ожидаем время сети…')}
              </p>
            )}
            {r.data.sessions.map((s) => (
              <section
                key={s.id}
                className="grid gap-6 lg:grid-cols-[1fr_1.2fr]"
              >
                <div className="panel self-start">
                  <p className="eyebrow mb-3">
                    {s.published ? t('Регистрация') : t('Черновик')}
                  </p>
                  <h2 className="text-2xl font-semibold mb-4">{s.title}</h2>
                  <p className="text-muted-foreground mb-6">
                    {t('{0} мест · Вход {1}', [
                      s.capacity,
                      date(s.policy.checkinOpen),
                    ])}
                  </p>
                  <label className="flex items-start gap-3 text-sm mb-6">
                    <input
                      type="checkbox"
                      checked={accepted.includes(s.id)}
                      onChange={(e) =>
                        setAccepted((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((x) => x !== s.id),
                        )
                      }
                      className="min-h-5 size-5 shrink-0"
                    />
                    {t(
                      'Я прочитал условия залога, сроки возврата и правила неявки.',
                    )}
                  </label>
                  <Button
                    disabled={
                      !accepted.includes(s.id) ||
                      busy ||
                      r.data?.cancelled ||
                      !s.published ||
                      chainNow === null ||
                      chainNow >= s.policy.bookingClose
                    }
                    onClick={() => void reserve(s.id)}
                  >
                    {t('Забронировать место')}
                  </Button>
                  {chainNow !== null && chainNow >= s.policy.bookingClose && (
                    <p
                      role="status"
                      className="mt-3 text-sm text-muted-foreground"
                    >
                      {t('Регистрация закрыта.')}
                    </p>
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">
                    {t(
                      'Если мест нет, добавим в очередь. Залог вносится только после получения места. Подтверждение условий ещё не списывает токены.',
                    )}
                  </p>
                </div>
                <Terms policy={s.policy} />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
