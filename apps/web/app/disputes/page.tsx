'use client';
import { useState } from 'react';
import {
  AuthGate,
  PageTitle,
  LoadState,
  Empty,
  Status,
  useResource,
} from '../../components/common';
import { useApp } from '../../components/providers';
import { Button } from '../../components/ui/button';
import { short, type Registration } from '../../lib/api';
export default function Disputes() {
  return (
    <AuthGate>
      <Content />
    </AuthGate>
  );
}
function Content() {
  const app = useApp(),
    [event, setEvent] = useState('');
  const events =
    app.me?.events.filter(
      (e, i, a) =>
        a.findIndex((x) => x.id === e.id) === i &&
        e.policy.resolver === app.wallet,
    ) ?? [];
  const selected = event || events[0]?.id;
  const r = useResource<Registration[]>(
    selected ? `events/${selected}/registrations` : null,
  );
  const disputes =
    r.data?.filter(
      (x) => x.dispute_description || x.deposit_state === 'Disputed',
    ) ?? [];
  return (
    <div className="page">
      <PageTitle
        title="Кабинет арбитра"
        description="Решение доступно только назначенному в условиях кошельку. Оно подтверждается транзакцией."
      />
      <label className="field mb-6 max-w-xl">
        Событие
        <select
          aria-label="Событие"
          value={selected ?? ''}
          onChange={(e) => setEvent(e.target.value)}
        >
          {!events.length && <option value="">Вы не назначены арбитром</option>}
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      <LoadState {...r} retry={r.reload} />
      {!r.loading && !disputes.length && (
        <Empty title="Нет обращений">
          Новые споры появятся здесь после обращения участника.
        </Empty>
      )}
      <div className="stack">
        {disputes.map((row) => (
          <Dispute key={row.id} row={row} refresh={r.reload} />
        ))}
      </div>
    </div>
  );
}
function Dispute({
  row,
  refresh,
}: {
  row: Registration;
  refresh: () => Promise<void>;
}) {
  const app = useApp(),
    e = useResource<{ id: string; media_type: string; size: number }[]>(
      `disputes/${row.id}/evidence`,
    );
  const resolve = async (action: string) => {
    try {
      await app.transact(`registrations/${row.id}/transaction`, { action });
      await refresh();
    } catch (err) {
      app.report((err as Error).message);
    }
  };
  return (
    <article className="panel">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="font-semibold">
          {row.title} · {short(row.wallet)}
        </h2>
        <Status value={row.deposit_state} />
      </div>
      <p className="my-5 whitespace-pre-wrap">
        {row.dispute_description ?? 'Описание не загружено.'}
      </p>
      <LoadState {...e} retry={e.reload} />
      <ul className="mb-5">
        {e.data?.map((file, i) => (
          <li key={file.id}>
            <a
              href={`/api/evidence/${file.id}`}
              className="link inline-block py-2"
              download
            >
              Материал {i + 1} · {file.media_type} ·{' '}
              {Math.ceil(file.size / 1024)} KiB
            </a>
          </li>
        ))}
      </ul>
      {row.decision ? (
        <p>
          Решение:{' '}
          {row.decision === 'refund' ? 'вернуть залог' : 'применить удержание'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={app.busy || row.deposit_state !== 'Disputed'}
            onClick={() => void resolve('resolve_refund')}
          >
            Вернуть залог
          </Button>
          <Button
            variant="outline"
            disabled={app.busy || row.deposit_state !== 'Disputed'}
            onClick={() => void resolve('resolve_forfeit')}
          >
            Применить удержание {row.policy.penaltyBps / 100}%
          </Button>
        </div>
      )}
    </article>
  );
}
