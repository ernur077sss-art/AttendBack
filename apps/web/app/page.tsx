'use client';
import Link from 'next/link';
import { ArrowRight, TicketCheck, RotateCcw, ScanLine } from 'lucide-react';
import {
  useResource,
  PageTitle,
  LoadState,
  Empty,
  EventCard,
} from '../components/common';
import type { Event } from '../lib/api';
const steps = [
  {
    Icon: TicketCheck,
    title: 'Забронируйте место',
    description: 'Внесите тестовый USDC на отдельный счёт программы.',
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
export default function Home() {
  const r = useResource<Event[]>('events');
  return (
    <div className="page">
      <section className="grid gap-10 border-b pb-12 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="eyebrow mb-5">Бронирование с ответственностью</p>
          <h1 className="max-w-2xl text-4xl md:text-6xl leading-[1.08] font-semibold tracking-tight">
            Приходите.
            <br />
            <span className="text-muted-foreground">Залог вернётся.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground leading-8">
            Забронируйте место на событии, подтвердите присутствие и получите
            залог обратно. Условия заранее закреплены в Solana.
          </p>
          <Link
            href="/organizer"
            className="mt-6 inline-flex items-center gap-2 min-h-11 font-semibold"
          >
            Организовать событие
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <ol className="grid content-center gap-6">
          {steps.map(({ Icon, title, description }, i) => (
            <li key={title} className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon aria-hidden="true" size={22} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">0{i + 1}</p>
                <h2 className="font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="pt-10">
        <PageTitle
          title="Предстоящие события"
          description="Митапы, мастер-классы и конференции — в одном месте."
        />
        <LoadState {...r} retry={r.reload} />
        {r.data?.length === 0 && (
          <Empty title="Первое событие — за вами">
            <Link href="/organizer" className="link">
              Создать событие
            </Link>
          </Empty>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {r.data?.map((e) => (
            <EventCard event={e} key={e.session_id} />
          ))}
        </div>
      </section>
    </div>
  );
}
