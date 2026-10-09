'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useI18n } from '../../../../packages/i18n/react';
import { DemoTicket } from '../../components/demo-ticket';
import { Button } from '../../components/ui/button';
const stages = [
  {
    title: '1. Проверьте условия',
    body: 'На странице события гость видит сумму, срок бесплатной отмены, удержание за неявку и защитный срок возврата. Только после согласия он бронирует место и подписывает перевод.',
    action: 'Показать пример билета',
  },
  {
    title: '2. Приходите с билетом',
    body: 'После подтверждения залога гость получает билет с QR. На настоящем событии сотрудник сканирует его и подтверждает посещение. Повторная отметка не создаёт вторую выплату.',
    action: 'Показать пример возврата',
  },
  {
    title: '3. Проверьте возврат',
    body: 'После подтверждения посещения обработчик отправляет возврат. Билет остаётся активным, а в реестре появляется квитанция с подписью только после окончательного подтверждения Solana.',
    action: 'Начать заново',
  },
];
export default function Demo() {
  const { t, locale } = useI18n();
  const [stage, setStage] = useState(0);
  const current = stages[stage];
  return (
    <div className="page">
      <p className="eyebrow mb-4">{t('Интерактивный обзор')}</p>
      <h1 className="text-4xl font-semibold tracking-tight">
        {t('Попробуйте сценарий за минуту')}
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground leading-7">
        {t(
          'Это учебный пример без кошелька и платежей. Он не создаёт регистрацию, не подписывает транзакции и не подтверждает реальный возврат.',
        )}
      </p>
      <div className="grid gap-10 mt-10 lg:grid-cols-[1.2fr_1fr] items-start">
        <section aria-label={t('Шаги демонстрации')}>
          <ol className="flex flex-wrap gap-2 mb-8">
            {stages.map((s, i) => (
              <li key={s.title}>
                <Button
                  variant={stage === i ? 'default' : 'outline'}
                  aria-current={stage === i ? 'step' : undefined}
                  onClick={() => setStage(i)}
                >
                  {t(s.title)}
                </Button>
              </li>
            ))}
          </ol>
          <div aria-live="polite" aria-atomic="true" className="min-h-44">
            <h2 className="text-2xl font-semibold">{t(current.title)}</h2>
            <p className="mt-4 leading-8 text-muted-foreground max-w-xl">
              {t(current.body)}
            </p>
          </div>
          <Button
            className="mt-6"
            size="lg"
            onClick={() =>
              setStage((previous) => (previous + 1) % stages.length)
            }
          >
            {t(current.action)}
            {stage === 2 ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
          </Button>
          <div className="mt-10 border-t pt-6">
            <h2 className="text-lg font-semibold">
              {t('А если планы изменились?')}
            </h2>
            <p className="text-muted-foreground leading-7 mt-3">
              {t(
                'Ранняя отмена возвращает весь залог и освобождает место для очереди. Поздняя отмена или неявка обрабатываются по опубликованным правилам. При ошибке подтверждения гость может открыть спор в установленный срок.',
              )}
            </p>
          </div>
        </section>
        <DemoTicket stage={stage} />
      </div>
      <section className="landing-section mt-12">
        <h2 className="text-2xl font-semibold">
          {t('Готовы открыть настоящий интерфейс?')}
        </h2>
        <p className="mt-3 text-muted-foreground">
          {t(
            'Рабочие операции выполняются в devnet и требуют кошелька, тестовых SOL и тестовых USDC.',
          )}
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <Button asChild>
            <Link href={`/organizer?lang=${locale}`}>
              {t('Создать мероприятие')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/?lang=${locale}#events-title`}>
              {t('Открыть события')}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
