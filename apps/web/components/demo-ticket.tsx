'use client';
import { CalendarDays, MapPin, QrCode, RotateCcw, Check } from 'lucide-react';
import { useI18n } from '../../../packages/i18n/react';

/** Illustrative only: never contains a live ticket token or transaction receipt. */
export function DemoTicket({ stage = 1 }: { stage?: number }) {
  const { t } = useI18n();
  return (
    <article className="demo-ticket" aria-label={t('Пример билета')}>
      <div className="flex items-center justify-between gap-4 border-b pb-5">
        <span className="flex items-center gap-2 font-semibold">
          <RotateCcw size={20} aria-hidden="true" />
          AttendBack
        </span>
        <span className="eyebrow">{t('Образец · не билет')}</span>
      </div>
      <p className="eyebrow mt-6 mb-2">{t('Встреча сообщества')}</p>
      <h2 className="text-2xl font-semibold tracking-tight">
        {t('Идеи становятся встречами')}
      </h2>
      <div className="grid gap-2 mt-5 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <CalendarDays size={16} aria-hidden="true" />
          {t('Суббота · 18:00–20:00')}
        </p>
        <p className="flex items-center gap-2">
          <MapPin size={16} aria-hidden="true" />
          {t('Астана · демоплощадка')}
        </p>
      </div>
      <div className="my-6 border-y border-dashed py-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('Возвратный залог')}
          </p>
          <p className="text-4xl font-semibold tracking-tight mt-1">
            5 <span className="text-lg">USDC</span>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t('Пример суммы · тестовые токены')}
          </p>
        </div>
        <div className="bg-muted p-3 rounded-lg">
          <QrCode size={68} aria-hidden="true" />
          <p className="text-xs text-center mt-1">{t('Образец QR')}</p>
        </div>
      </div>
      <p
        className="demo-ticket-status flex items-center gap-2 text-sm font-medium"
        data-complete={stage === 2}
      >
        <Check size={18} aria-hidden="true" />
        {t(
          stage === 0
            ? 'Пример: условия выбраны'
            : stage === 1
              ? 'Пример: место подтверждено'
              : 'Пример: залог возвращён',
        )}
      </p>
      <p className="text-xs text-muted-foreground mt-3">
        {t(
          'Иллюстрация сценария. Реального бронирования и перевода здесь нет.',
        )}
      </p>
    </article>
  );
}
