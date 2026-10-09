'use client';
import { useI18n } from '../../../packages/i18n/react';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin, ShieldCheck } from 'lucide-react';
import { api, type Event, statuses } from '../lib/api';
import type { Policy } from '../../../packages/domain/src';
import { displayAmount } from '../../../packages/domain/src';
import { useApp } from './providers';
import { Button } from './ui/button';
export function useResource<T>(path: string | null) {
  const sequence = useRef(0),
    currentPath = useRef(path);
  currentPath.current = path;
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    setError('');
    const request = ++sequence.current;
    try {
      const result = await api<T>(path);
      if (request === sequence.current && path === currentPath.current)
        setData(result);
    } catch (e) {
      if (request === sequence.current && path === currentPath.current)
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      if (request === sequence.current && path === currentPath.current)
        setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(undefined);
    setLoading(true);
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  return { data, error, loading, reload: load };
}
export function useChainClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const update = async () => {
      try {
        const value = await api<{ unixTime: number }>('clock');
        if (live) setNow(value.unixTime);
      } catch {
        if (live) setNow(null);
      }
    };
    void update();
    const timer = setInterval(() => void update(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return now;
}
export function PageTitle({
  overline,
  title,
  description,
  action,
}: {
  overline?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        {overline && <p className="eyebrow mb-3">{overline}</p>}
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-3 text-muted-foreground leading-7">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => unknown;
}) {
  const { t, message } = useI18n();

  return loading ? (
    <div className="panel" role="status">
      {t('Загружаем данные…')}
    </div>
  ) : error ? (
    <div className="panel border-destructive">
      <p role="alert" className="mb-4">
        {message(error)}
      </p>
      <Button variant="outline" onClick={() => void retry()}>
        {t('Повторить')}
      </Button>
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="panel py-12 text-center">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  const app = useApp();
  return app.me ? (
    <>{children}</>
  ) : (
    <div className="page">
      <Empty title={t('Войдите, чтобы продолжить')}>
        <p className="mb-6">
          {t('Билеты и права доступа привязаны к вашему кошельку.')}
        </p>
        <Button onClick={app.login}>{t('Подключить кошелёк')}</Button>
      </Empty>
    </div>
  );
}
export function Status({ value }: { value: string | null }) {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
      {value ? t(statuses[value] ?? value) : t('Без залога')}
    </span>
  );
}
export function EventCard({ event }: { event: Event }) {
  const { t, date } = useI18n();

  return (
    <article className="panel flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{event.organization}</p>
        <span className="text-xs text-muted-foreground">
          {event.cancelled
            ? t('Отменено')
            : t('{0} из {1} мест', [
                Math.max(0, event.capacity - event.occupied),
                event.capacity,
              ])}
        </span>
      </div>
      <div>
        <h2 className="text-xl font-semibold">
          <Link
            href={`/events/${event.id}`}
            className="hover:underline underline-offset-4"
          >
            {event.title}
          </Link>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {event.description}
        </p>
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground">
        <span className="flex gap-2">
          <CalendarDays size={16} aria-hidden="true" />
          {date(event.policy.checkinOpen)}
        </span>
        <span className="flex gap-2">
          <MapPin size={16} aria-hidden="true" />
          {event.location}
        </span>
      </div>
      <div className="mt-auto flex items-center justify-between border-t pt-5">
        <div>
          <strong className="text-xl font-semibold tabular-nums">
            {displayAmount(event.policy.amount)} USDC
          </strong>
          <p className="text-xs text-muted-foreground">
            {t('возвратный залог · тест')}
          </p>
        </div>
        <Link
          className="flex min-h-10 items-center gap-2 text-sm font-semibold"
          href={`/events/${event.id}`}
        >
          {t('Подробнее')}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
export function Terms({ policy: p }: { policy: Policy }) {
  const { t, date } = useI18n();

  return (
    <div className="panel">
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck size={20} aria-hidden="true" />
        {t('Условия залога')}
      </h2>
      <dl className="review-grid">
        <dt>{t('Залог')}</dt>
        <dd>{t('{0} тестовых USDC', [displayAmount(p.amount)])}</dd>
        <dt>{t('После посещения')}</dt>
        <dd>{t('100% залога после подтверждения сотрудником')}</dd>
        <dt>{t('Бесплатная отмена')}</dt>
        <dd>{t('До {0}', [date(p.freeCancelUntil)])}</dd>
        <dt>{t('Поздняя отмена / неявка')}</dt>
        <dd>
          {t('Удержание {0}%, после окна оспаривания', [p.penaltyBps / 100])}
        </dd>
        <dt>{t('Время входа')}</dt>
        <dd>
          {date(p.checkinOpen)} — {date(p.checkinClose)}
        </dd>
        <dt>{t('Открыть спор')}</dt>
        <dd>{t('После окончания входа, до {0}', [date(p.disputeDeadline)])}</dd>
        <dt>{t('Решение арбитра')}</dt>
        <dd>{t('До {0}', [date(p.resolutionDeadline)])}</dd>
        <dt>{t('Защитный возврат')}</dt>
        <dd>{t('С {0} — весь незавершённый залог', [date(p.hardRefundAt)])}</dd>
      </dl>
      <details className="mt-5 text-xs">
        <summary className="cursor-pointer min-h-10 py-2 text-muted-foreground">
          {t('Адреса и доверие')}
        </summary>
        <p className="my-2">
          {t(
            'Присутствие подтверждает сотрудник, спор решает назначенный арбитр. Комиссии Solana и хранение аккаунтов не входят в залог. Программа обновляема владельцем upgrade authority.',
          )}
        </p>
        <dl className="grid gap-2 break-all">
          <dt>{t('Арбитр: {0}', [p.resolver])}</dt>
          <dt>{t('Получатель удержания: {0}', [p.penaltyRecipient])}</dt>
          <dt>Mint: {p.mint}</dt>
        </dl>
      </details>
    </div>
  );
}
