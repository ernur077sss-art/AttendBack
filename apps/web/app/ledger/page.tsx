'use client';
import { useApp } from '../../components/providers';
import {
  AuthGate,
  PageTitle,
  Empty,
  LoadState,
  useResource,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import { api, date, short } from '../../lib/api';
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
  const app = useApp(),
    r = useResource<Receipt[]>('ledger'),
    jobs = useResource<Job[]>('jobs');
  return (
    <div className="page">
      <PageTitle
        title="Реестр расчётов"
        description="Только окончательно подтверждённые переводы. Комиссии сети не включены в суммы залога."
        action={
          <Button
            variant="outline"
            onClick={() => {
              void r.reload();
              void jobs.reload();
            }}
          >
            Обновить
          </Button>
        }
      />
      <LoadState {...r} retry={r.reload} />
      {r.data?.length === 0 && (
        <Empty title="Расчётов пока нет">
          Квитанция появится после подтверждения выплаты сетью.
        </Empty>
      )}
      {!!r.data?.length && (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Событие</th>
                <th>Возврат</th>
                <th>Удержано</th>
                <th>Подпись</th>
                <th>Подтверждено</th>
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
            Очередь и ошибки обработки
          </h2>
          <div className="panel stack">
            {jobs.data.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap justify-between gap-4 border-b pb-4"
              >
                <div>
                  <p>
                    {j.kind} · {j.status}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {j.error_code ?? 'Обработка запланирована'} · попыток:{' '}
                    {j.attempts}
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
                    Повторить обработку
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
