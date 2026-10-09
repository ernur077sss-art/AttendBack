'use client';
import { useI18n } from '../../../packages/i18n/react';
import Link from 'next/link';
import {
  ArrowRight,
  TicketCheck,
  RotateCcw,
  ScanLine,
  ArrowUpRight,
} from 'lucide-react';
import { useResource, LoadState, Empty, EventCard } from '../components/common';
import { DemoTicket } from '../components/demo-ticket';
import { Button } from '../components/ui/button';
import type { Event } from '../lib/api';

const steps = [
  {
    Icon: TicketCheck,
    title: 'Забронируйте место',
    description: 'Выберите событие и проверьте условия до внесения залога.',
  },
  {
    Icon: ScanLine,
    title: 'Покажите билет на входе',
    description: 'Сотрудник проверит QR и подтвердит посещение.',
  },
  {
    Icon: RotateCcw,
    title: 'Получите залог обратно',
    description: 'Возврат и его подпись появятся в вашем реестре.',
  },
];
const rules = [
  [
    'Вы пришли',
    '5 USDC обратно',
    'После подтверждения посещения и окончательного расчёта.',
  ],
  [
    'Вы отменили заранее',
    '5 USDC обратно',
    'До срока бесплатной отмены, указанного в билете.',
  ],
  [
    'Поздняя отмена или неявка',
    'Удержание по правилам',
    'Например, при удержании 20%: 1 USDC получателю, 4 USDC гостю. После окна оспаривания.',
  ],
];
export default function Home() {
  const { t, locale } = useI18n();
  const r = useResource<Event[]>('events');
  return (
    <div className="page">
      <section className="landing-hero">
        <div>
          <p className="eyebrow mb-6">{t('Бронирование с ответственностью')}</p>
          <h1 className="max-w-2xl text-5xl md:text-6xl leading-[1.08] font-semibold tracking-tight">
            {t('Приходите.')}
            <br />
            <span className="text-muted-foreground">
              {t('Залог вернётся.')}
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground leading-8">
            {t(
              'Место для гостя. Управление явкой для организатора. Возвратный залог и правила, известные до бронирования.',
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-8">
            <Button asChild size="lg">
              <Link href="/organizer">
                {t('Создать мероприятие')}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/demo?lang=${locale}`}>{t('Посмотреть демо')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            {t('Демо без кошелька · Русский и English')}
          </p>
          <p className="border-t mt-10 pt-5 text-sm text-muted-foreground max-w-lg">
            {t(
              'Для воркшопов, конференций и сообществ. Собственная регистрация — без привязки к платформе билетов.',
            )}
          </p>
        </div>
        <div className="landing-ticket-wrap">
          <DemoTicket />
        </div>
      </section>
      <section className="landing-section" aria-labelledby="how-title">
        <div className="mb-8">
          <p className="eyebrow mb-3">{t('Как это работает')}</p>
          <h2 id="how-title" className="text-3xl font-semibold tracking-tight">
            {t('От бронирования до возврата')}
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-3">
          {steps.map(({ Icon, title, description }, i) => (
            <li key={title} className="border-t pt-5">
              <div className="flex items-center justify-between mb-6">
                <span className="eyebrow">0{i + 1}</span>
                <Icon aria-hidden="true" size={24} />
              </div>
              <h3 className="text-lg font-semibold">{t(title)}</h3>
              <p className="text-muted-foreground mt-2 leading-7">
                {t(description)}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <section className="landing-section" aria-labelledby="rules-title">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="eyebrow mb-3">{t('Прозрачные условия')}</p>
            <h2
              id="rules-title"
              className="text-3xl font-semibold tracking-tight"
            >
              {t('Заранее знаете, что вернётся')}
            </h2>
            <p className="text-muted-foreground leading-7 mt-4">
              {t(
                'Пример для залога 5 тестовых USDC. Сумму, сроки и долю удержания организатор задаёт до публикации. У каждого события свои условия.',
              )}
            </p>
          </div>
          <dl className="grid gap-5">
            {rules.map(([title, value, description]) => (
              <div key={title} className="border-b pb-5">
                <dt className="font-semibold">{t(title)}</dt>
                <dd className="mt-1 font-medium">{t(value)}</dd>
                <dd className="text-sm text-muted-foreground mt-2 leading-6">
                  {t(description)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-6 text-sm text-muted-foreground leading-6">
          {t(
            'Сетевые комиссии и хранение аккаунтов оплачиваются отдельно. Если событие отменено или наступил защитный срок, незавершённый залог возвращается полностью.',
          )}
        </p>
      </section>
      <section className="landing-section" aria-labelledby="events-title">
        <div className="mb-8">
          <p className="eyebrow mb-3">{t('Открытый каталог')}</p>
          <h2
            id="events-title"
            className="text-3xl font-semibold tracking-tight"
          >
            {t('Опубликованные события')}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              'Сейчас это тестовая сеть: события и USDC используются для проверки продукта.',
            )}
          </p>
        </div>
        <LoadState {...r} retry={r.reload} />
        {r.data?.length === 0 && (
          <Empty title={t('Первое событие — за вами')}>
            <Link href="/organizer" className="link">
              {t('Создать событие')}
            </Link>
          </Empty>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {r.data?.map((e) => (
            <EventCard event={e} key={e.session_id} />
          ))}
        </div>
      </section>
      <section className="landing-section" aria-labelledby="trust-title">
        <h2 id="trust-title" className="text-3xl font-semibold tracking-tight">
          {t('Правила в Solana. Посещение — на площадке.')}
        </h2>
        <div className="grid gap-8 mt-8 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-lg">
              {t('Что проверяет программа')}
            </h3>
            <p className="mt-3 text-muted-foreground leading-7">
              {t(
                'Сумму, сроки и получателей выплат. Опубликованные условия залога не меняются. Квитанция появляется после окончательного подтверждения в сети.',
              )}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-lg">
              {t('За что отвечают люди')}
            </h3>
            <p className="mt-3 text-muted-foreground leading-7">
              {t(
                'Сотрудник подтверждает вход, назначенный арбитр решает спор. Владелец полномочий обновления может обновлять программу. Независимый возврат доступен при выполнении правил.',
              )}
            </p>
          </div>
        </div>
        <Link
          href={`/demo?lang=${locale}`}
          className="inline-flex items-center gap-2 min-h-11 mt-6 font-semibold"
        >
          {t('Пройти демонстрацию')}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
