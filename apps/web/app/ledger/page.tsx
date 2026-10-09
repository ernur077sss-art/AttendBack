'use client';
import { useI18n } from '../../../../packages/i18n/react';

import { useApp } from '../../components/providers';
import {
  AuthGate,
  PageTitle,
  Empty,
  LoadState,
  useResource,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { api, short } from '../../lib/api';
import { displayAmount } from '../../../../packages/domain/src';
type Receipt = {
  id: string;
  title: string;
  refund: string;
  penalty: string;
  signature: string;
  finalized_at: string;
};
type Job = {
  id: string;
  kind: string;
  status: string;
  error_code: string;
  attempts: number;
};
export default function Ledger() {
  return (
    <AuthGate>
      <Content />
    </AuthGate>
  );
}
function Content() {
  const { t, date } = useI18n();

  const app = useApp(),
    r = useResource<Receipt[]>('ledger'),
    jobs = useResource<Job[]>('jobs');
  return (
    <div className="page">
      <PageTitle
        title={t('Реестр расчётов')}
        description={t(
          'Только окончательно подтверждённые переводы. Комиссии сети не включены в суммы залога.',
        )}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void r.reload();
              void jobs.reload();
            }}
          >
            {t('Обновить')}
          </Button>
        }
      />
      <LoadState {...r} retry={r.reload} />
      {r.data?.length === 0 && (
        <Empty title={t('Расчётов пока нет')}>
          {t('Квитанция появится после подтверждения выплаты сетью.')}
        </Empty>
      )}
      {!!r.data?.length && (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Событие')}</th>
                <th>{t('Возврат')}</th>
                <th>{t('Удержано')}</th>
                <th>{t('Подпись')}</th>
                <th>{t('Подтверждено')}</th>
              </tr>
            </thead>
            <tbody>
              {r.data.map((x) => (
                <tr key={x.id}>
                  <td>{x.title}</td>
                  <td className="tabular-nums whitespace-nowrap">
                    {displayAmount(x.refund)} USDC
                  </td>
                  <td className="tabular-nums whitespace-nowrap">
                    {displayAmount(x.penalty)} USDC
                  </td>
                  <td>
                    {app.config.cluster === 'devnet' ? (
                      <a
                        className="link font-mono"
                        href={`https://explorer.solana.com/tx/${x.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(x.signature)}
                      </a>
                    ) : (
                      <details>
                        <summary className="cursor-pointer py-2 font-mono">
                          {short(x.signature)}
                        </summary>
                        <code className="break-all text-xs">{x.signature}</code>
                      </details>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{date(x.finalized_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!jobs.data?.length && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold mb-5">
            {t('Очередь и ошибки обработки')}
          </h2>
          <div className="panel stack">
            {jobs.data.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap justify-between gap-4 border-b pb-4"
              >
                <div>
                  <p>
                    {t(jobLabels[j.kind] ?? j.kind)} ·{' '}
                    {t(jobLabels[j.status] ?? j.status)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('{0} · попыток: {1}', [
                      j.error_code ?? t('Обработка запланирована'),
                      j.attempts,
                    ])}
                  </p>
                </div>
                {j.status === 'failed' && j.kind !== 'sync' && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await api(`jobs/${j.id}/retry`, {});
                        await jobs.reload();
                      } catch (e) {
                        app.report((e as Error).message);
                      }
                    }}
                  >
                    {t('Повторить обработку')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const jobLabels: Record<string, string> = {
  attest: 'Подтверждение посещения',
  no_show: 'Проверка неявки',
  settle: 'Расчёт залога',
  timeout: 'Защитный возврат',
  sync: 'Синхронизация',
  notify: 'Уведомление',
  ready: 'В очереди',
  leased: 'В обработке',
  submitted: 'Отправлено в сеть',
  done: 'Готово',
  failed: 'Ошибка',
};
