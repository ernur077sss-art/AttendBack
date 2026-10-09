'use client';
import { useI18n } from '../../../../../../packages/i18n/react';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '../../../../components/providers';
import {
  AuthGate,
  PageTitle,
  LoadState,
  useResource,
  Terms,
  Status,
} from '../../../../components/common';
import { SessionForm } from '../../../../components/session-form';
import { Button } from '../../../../components/ui/button';
import { short, type Event, type Registration } from '../../../../lib/api';
type CheckinEntry = {
  id: string;
  actor: string;
  action: string;
  revision: string;
  created_at: string;
  wallet: string;
  title: string;
};
export default function OrganizerEvent() {
  return (
    <AuthGate>
      <Content />
    </AuthGate>
  );
}
function Content() {
  const { t, date } = useI18n();

  const { id } = useParams<{ id: string }>(),
    app = useApp(),
    r = useResource<Event>(`events/${id}`),
    regs = useResource<Registration[]>(`events/${id}/registrations`),
    [add, setAdd] = useState(false);
  const role = app.me?.organizations.find((o) => o.id === r.data?.org_id)?.role,
    edit = role === 'owner' || role === 'manager';
  const history = useResource<CheckinEntry[]>(
    role && ['owner', 'manager', 'staff'].includes(role)
      ? `events/${id}/checkins`
      : null,
  );
  const tx = async (path: string) => {
    try {
      await app.transact(path, {});
      await r.reload();
      await regs.reload();
      await app.refresh();
    } catch (e) {
      app.report((e as Error).message);
    }
  };
  return (
    <div className="page">
      <LoadState {...r} retry={r.reload} />
      {r.data && (
        <>
          <PageTitle
            overline={t('Управление событием')}
            title={r.data.title}
            action={
              <Link className="link" href={`/events/${id}`}>
                {t('Публичная страница')}
              </Link>
            }
          />
          <div className="flex flex-wrap gap-4 mb-8">
            <p className="panel flex-1">
              {t('Регистраций: ')}
              <strong>{regs.data?.length ?? '—'}</strong>
            </p>
            <p className="panel flex-1">
              {t('Активных билетов:')}{' '}
              <strong>
                {regs.data?.filter((r) => r.seat_state === 'Active').length ??
                  '—'}
              </strong>
            </p>
            <p className="panel flex-1">
              {t('Отмечено на входе:')}{' '}
              <strong>
                {regs.data?.filter((r) => r.checkin_corrected === false)
                  .length ?? '—'}
              </strong>
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {r.data.sessions.map((s) => (
              <section key={s.id} className="stack">
                <div className="panel">
                  <div className="flex justify-between gap-4">
                    <h2 className="text-xl font-semibold">{s.title}</h2>
                    <span className="text-sm">
                      {s.published ? t('Опубликовано') : t('Черновик')}
                    </span>
                  </div>
                  <p className="my-4 text-sm text-muted-foreground">
                    {t('{0} мест', [s.capacity])}
                  </p>
                  {!s.published && edit && (
                    <Button
                      disabled={app.busy}
                      onClick={() => void tx(`sessions/${s.id}/publish`)}
                    >
                      {t('Опубликовать в Solana')}
                    </Button>
                  )}
                </div>
                <Terms policy={s.policy} />
              </section>
            ))}
          </div>
          <section className="panel mt-8">
            <h2 className="text-xl font-semibold mb-4">{t('Участники')}</h2>
            <LoadState {...regs} retry={regs.reload} />
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Кошелёк')}</th>
                    <th>{t('Место')}</th>
                    <th>{t('Залог')}</th>
                    <th>{t('Вход')}</th>
                  </tr>
                </thead>
                <tbody>
                  {regs.data?.map((row) => (
                    <tr key={row.id}>
                      <td title={row.wallet}>{short(row.wallet)}</td>
                      <td>
                        <Status value={row.seat_state} />
                      </td>
                      <td>
                        <Status value={row.deposit_state} />
                      </td>
                      <td>
                        {row.checkin_corrected === false
                          ? t('Подтверждён')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {role && ['owner', 'manager', 'staff'].includes(role) && (
            <section className="panel mt-8">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-xl font-semibold">{t('Журнал входа')}</h2>
                <Button variant="outline" onClick={() => void history.reload()}>
                  {t('Обновить журнал')}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {t(
                  'Последние 500 отметок и исправлений: кто выполнил действие и когда.',
                )}
              </p>
              <LoadState {...history} retry={history.reload} />
              {history.data?.length === 0 && <p>{t('Отметок пока нет.')}</p>}
              {!!history.data?.length && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Время')}</th>
                        <th>{t('Сессия / участник')}</th>
                        <th>{t('Действие')}</th>
                        <th>{t('Сотрудник')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.map((row) => (
                        <tr key={row.id}>
                          <td>{date(row.created_at)}</td>
                          <td>
                            {row.title}
                            <br />
                            <span title={row.wallet}>{short(row.wallet)}</span>
                          </td>
                          <td>
                            {row.action === 'checkin.corrected'
                              ? t('Отметка отменена')
                              : t('Вход подтверждён')}{' '}
                            · №{row.revision}
                          </td>
                          <td title={row.actor}>{short(row.actor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {edit && (
            <div className="mt-8 stack">
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => setAdd(!add)}>
                  {add ? t('Закрыть форму') : t('Добавить сессию')}
                </Button>
                <Button
                  variant="outline"
                  disabled={app.busy || r.data.cancelled}
                  onClick={() => void tx(`events/${id}/cancel`)}
                >
                  {t('Отменить всё событие')}
                </Button>
              </div>
              {add && (
                <SessionForm
                  eventId={id}
                  onSaved={() => {
                    setAdd(false);
                    void r.reload();
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
