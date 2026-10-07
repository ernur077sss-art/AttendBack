'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '../../../components/providers';
import {
  useResource,
  PageTitle,
  LoadState,
  Terms,
} from '../../../components/common';
import { Button } from '../../../components/ui/button';
import { api, type Event, type Registration, date } from '../../../lib/api';
export default function EventPage() {
  const { id } = useParams<{ id: string }>(),
    r = useResource<Event>(`events/${id}`),
    app = useApp(),
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
            {r.data.location} {r.data.cancelled && '· Событие отменено'}
          </p>
          <div className="stack">
            {r.data.sessions.map((s) => (
              <section
                key={s.id}
                className="grid gap-6 lg:grid-cols-[1fr_1.2fr]"
              >
                <div className="panel self-start">
                  <p className="eyebrow mb-3">
                    {s.published ? 'Регистрация' : 'Черновик'}
                  </p>
                  <h2 className="text-2xl font-semibold mb-4">{s.title}</h2>
                  <p className="text-muted-foreground mb-6">
                    {s.capacity} мест · Вход {date(s.policy.checkinOpen)}
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
                    Я прочитал условия залога, сроки возврата и правила неявки.
                  </label>
                  <Button
                    disabled={
                      !accepted.includes(s.id) ||
                      busy ||
                      r.data?.cancelled ||
                      !s.published ||
                      Date.now() / 1000 >= s.policy.bookingClose
                    }
                    onClick={() => void reserve(s.id)}
                  >
                    Забронировать место
                  </Button>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Если мест нет, добавим в очередь. Залог вносится только
                    после получения места. Подтверждение условий ещё не
                    списывает токены.
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
