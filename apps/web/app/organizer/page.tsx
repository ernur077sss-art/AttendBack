'use client';
import { useI18n } from '../../../../packages/i18n/react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '../../components/providers';
import { AuthGate, PageTitle } from '../../components/common';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SessionForm } from '../../components/session-form';
import { api } from '../../lib/api';
export default function Organizer() {
  const { t, message } = useI18n();

  const app = useApp(),
    router = useRouter(),
    [org, setOrg] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const editable =
    app.me?.organizations.filter((o) =>
      ['owner', 'manager'].includes(o.role),
    ) ?? [];
  const selected = org || editable[0]?.id;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await app.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthGate>
      <div className="page">
        <PageTitle
          title={t('Кабинет организатора')}
          description={t(
            'Создавайте события, управляйте доступом и отслеживайте явку.',
          )}
        />
        {error && (
          <p role="alert" className="panel mb-5 border-destructive">
            {message(error)}
          </p>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="stack self-start">
            <form
              className="panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get('name'));
                void run(async () => {
                  const o = await api<{ id: string }>('organizations', {
                    name,
                  });
                  setOrg(o.id);
                });
              }}
            >
              <h2 className="text-xl font-semibold">{t('Организация')}</h2>
              <label className="field">
                {t('Название')}
                <Input
                  name="name"
                  required
                  minLength={2}
                  maxLength={140}
                  placeholder={t('Ваша команда или площадка')}
                />
              </label>
              <Button variant="outline" disabled={busy}>
                {t('Создать организацию')}
              </Button>
            </form>
            {!!editable.length && (
              <div className="panel">
                <label className="field">
                  {t('Рабочая организация')}
                  <select
                    value={selected}
                    onChange={(e) => setOrg(e.target.value)}
                  >
                    {editable.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selected &&
              app.me?.organizations.find((o) => o.id === selected)?.role ===
                'owner' && (
                <form
                  className="panel stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      api('members', {
                        orgId: selected,
                        wallet: f.get('wallet'),
                        role: f.get('role'),
                      }),
                    );
                  }}
                >
                  <h2 className="text-xl font-semibold">
                    {t('Назначить доступ')}
                  </h2>
                  <label className="field">
                    {t('Кошелёк сотрудника')}
                    <Input
                      name="wallet"
                      required
                      minLength={32}
                      maxLength={44}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    {t('Роль')}
                    <select name="role">
                      <option value="staff">{t('Сотрудник входа')}</option>
                      <option value="manager">{t('Менеджер')}</option>
                      <option value="resolver">{t('Арбитр')}</option>
                    </select>
                  </label>
                  <Button variant="outline" disabled={busy}>
                    {t('Сохранить роль')}
                  </Button>
                </form>
              )}
            <section className="panel">
              <h2 className="text-xl font-semibold mb-4">
                {t('Ваши события')}
              </h2>
              {!app.me?.events.length && (
                <p className="text-sm text-muted-foreground">
                  {t('Событий пока нет. Начните с черновика.')}
                </p>
              )}
              <ul className="divide-y">
                {app.me?.events
                  .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
                  .map((e) => (
                    <li className="py-4" key={e.id}>
                      <Link
                        className="font-semibold link"
                        href={`/organizer/events/${e.id}`}
                      >
                        {e.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-2">
                        {e.cancelled
                          ? t('Отменено')
                          : e.published
                            ? t('Опубликовано')
                            : t('Черновик')}
                      </p>
                    </li>
                  ))}
              </ul>
            </section>
          </div>
          {selected && (
            <SessionForm
              key={selected}
              orgId={selected}
              onSaved={(id) => {
                void app.refresh();
                router.push(`/organizer/events/${id}`);
              }}
            />
          )}
        </div>
      </div>
    </AuthGate>
  );
}
