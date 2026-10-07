'use client';
import { useState, type FormEvent } from 'react';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { useApp } from './providers';
import { api } from '../lib/api';
const deadlines = [
  ['bookingClose', 'Закрытие регистрации', 0],
  ['freeCancelUntil', 'Бесплатная отмена до', 0],
  ['checkinOpen', 'Начало входа', 1],
  ['checkinClose', 'Окончание входа', 3],
  ['proposalCutoff', 'Предложение неявки до', 4],
  ['disputeDeadline', 'Открыть спор до', 27],
  ['resolutionDeadline', 'Решить спор до', 51],
  ['hardRefundAt', 'Защитный возврат с', 75],
] as const;
const localDate = (hours: number) => {
  const d = new Date(Date.now() + 24 * 3600000 + hours * 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function SessionForm({
  orgId,
  eventId,
  onSaved,
}: {
  orgId?: string;
  eventId?: string;
  onSaved: (id: string) => void;
}) {
  const app = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const raw = String(form.get('amount'));
      if (!/^\d+(\.\d{1,6})?$/.test(raw))
        throw new Error('Сумма: до 6 знаков после точки');
      const [whole, frac = ''] = raw.split('.');
      const amount = (
        BigInt(whole) * 1000000n +
        BigInt(frac.padEnd(6, '0'))
      ).toString();
      const policy = {
        amount,
        penaltyBps: Math.round(Number(form.get('penalty')) * 100),
        mint: app.config.mint,
        bookingAuthority: app.config.bookingAuthority,
        attester: app.config.attester,
        resolver: String(form.get('resolver')),
        penaltyRecipient: String(form.get('recipient')),
        ...Object.fromEntries(
          deadlines.map(([key]) => [
            key,
            Math.floor(new Date(String(form.get(key))).getTime() / 1000),
          ]),
        ),
      };
      const session = {
        title: String(form.get('title')),
        description: String(form.get('description')),
        location: String(form.get('location')),
        capacity: Number(form.get('capacity')),
        policy,
      };
      const result = await api<{ id: string }>(
        eventId ? 'sessions' : 'events',
        { ...(eventId ? { eventId } : { orgId }), session },
      );
      onSaved(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="panel stack">
      <h2 className="text-xl font-semibold">
        {eventId ? 'Новая сессия' : 'Новое событие'}
      </h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <label className="field">
        Название
        <Input
          name="title"
          minLength={3}
          maxLength={140}
          required
          placeholder="Например, Builders Meetup"
        />
      </label>
      <label className="field">
        Описание
        <Textarea
          name="description"
          maxLength={4000}
          placeholder="Что будет на событии и кому оно подойдёт"
        />
      </label>
      <label className="field">
        Место проведения
        <Input
          name="location"
          minLength={2}
          maxLength={240}
          required
          placeholder="Город, площадка, адрес"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="field">
          Количество мест
          <Input
            name="capacity"
            type="number"
            min={1}
            max={10000}
            defaultValue={30}
            required
          />
        </label>
        <label className="field">
          Залог, USDC (тест)
          <Input name="amount" inputMode="decimal" defaultValue="5" required />
        </label>
        <label className="field">
          Удержание, %
          <Input
            name="penalty"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={50}
            required
          />
        </label>
      </div>
      <fieldset className="stack">
        <legend className="font-semibold mb-4">
          Сроки · часовой пояс вашего устройства
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {deadlines.map(([key, label, offset]) => (
            <label key={key} className="field text-sm">
              {label}
              <Input
                type="datetime-local"
                name={key}
                defaultValue={localDate(offset)}
                required
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        Кошелёк арбитра
        <Input
          name="resolver"
          defaultValue={app.wallet ?? ''}
          required
          minLength={32}
          maxLength={44}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        Получатель удержания
        <Input
          name="recipient"
          defaultValue={app.wallet ?? ''}
          required
          minLength={32}
          maxLength={44}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Сначала создаётся черновик. Проверьте сроки перед публикацией: после
        подписи эти условия нельзя изменить. Арбитру нужно назначить роль в
        организации.
      </p>
      <Button disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить черновик'}
      </Button>
    </form>
  );
}
