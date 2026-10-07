'use client';
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera } from 'lucide-react';
import { AuthGate, PageTitle } from '../../components/common';
import { useApp } from '../../components/providers';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
export default function Checkin() {
  return (
    <AuthGate>
      <Scanner />
    </AuthGate>
  );
}
function Scanner() {
  const app = useApp(),
    [event, setEvent] = useState(''),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{ id: string; expires: number } | null>(
      null,
    ),
    [remaining, setRemaining] = useState(0),
    [camera, setCamera] = useState(false),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    frame = useRef(0);
  const events =
    app.me?.events.filter(
      (e, i, a) =>
        a.findIndex((x) => x.id === e.id) === i &&
        ['owner', 'manager', 'staff'].includes(
          app.me!.organizations.find((o) => o.id === e.org_id)?.role ?? '',
        ),
    ) ?? [];
  const selected = event || events[0]?.id;
  const stop = () => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    const t = setInterval(
      () =>
        setRemaining(
          result
            ? Math.max(0, Math.ceil((result.expires - Date.now()) / 1000))
            : 0,
        ),
      500,
    );
    return () => clearInterval(t);
  }, [result]);
  const start = async () => {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Для камеры нужен HTTPS или localhost. Можно ввести код вручную.',
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      setCamera(true);
      const v = video.current!;
      v.srcObject = stream.current;
      await v.play();
      const canvas = document.createElement('canvas');
      const scan = () => {
        if (v.readyState >= 2) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(pixels.data, pixels.width, pixels.height);
          if (qr) {
            setToken(qr.data);
            stop();
            return;
          }
        }
        frame.current = requestAnimationFrame(scan);
      };
      scan();
    } catch (e) {
      stop();
      setError((e as Error).message);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ duplicate?: boolean; eligibleAt?: string }>(
        'checkins',
        { eventId: selected, token },
      );
      setResult({
        id: token.split('.')[0],
        expires: res.duplicate
          ? Date.now()
          : new Date(res.eligibleAt ?? Date.now()).getTime(),
      });
      app.report(
        res.duplicate
          ? 'Этот билет уже отмечен. Повторная выплата не создана.'
          : 'Вход отмечен. В течение 30 секунд можно исправить ошибку.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page max-w-3xl mx-auto">
      <PageTitle
        title="Проверка билета"
        description="Выберите событие, отсканируйте QR и подтвердите вход."
      />
      <div className="panel stack">
        <label className="field">
          Событие
          <select
            aria-label="Событие"
            value={selected ?? ''}
            onChange={(e) => {
              setEvent(e.target.value);
              setResult(null);
            }}
          >
            {!events.length && <option value="">Нет доступных событий</option>}
            {events.map((e) => (
              <option value={e.id} key={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <video
          ref={video}
          muted
          playsInline
          aria-label="Камера для сканирования QR"
          className={camera ? 'w-full rounded-lg' : 'hidden'}
        />
        <Button
          variant="outline"
          disabled={!selected || busy}
          onClick={() => (camera ? stop() : void start())}
        >
          <Camera size={18} aria-hidden="true" />
          {camera ? 'Остановить камеру' : 'Сканировать камерой'}
        </Button>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            Код билета
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="Код из QR или билета участника"
            />
          </label>
          <Button disabled={!selected || busy}>
            {busy ? 'Проверяем…' : 'Подтвердить вход'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div className="border-t pt-5">
            <p className="mb-3">
              Отметка сохранена.{' '}
              {remaining > 0
                ? `Исправление доступно ещё ${remaining} с.`
                : 'Окно исправления закрыто.'}
            </p>
            <Button
              variant="outline"
              disabled={remaining <= 0 || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`checkins/${result.id}/correct`, {});
                  setResult(null);
                  app.report('Отметка входа отменена до отправки в сеть.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Исправить ошибочный вход
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
