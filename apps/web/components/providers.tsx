'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createClient,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  signTransactionWithSigners,
} from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';
import {
  useConnectedWallet,
  useWallets,
} from '@solana/kit-plugin-wallet/react';
import { ClientProvider } from '@solana/react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  api,
  type Config,
  type Prepared,
  type Dashboard,
  short,
  from64,
  to64,
} from '../lib/api';
import { displayAmount } from '../../../packages/domain/src';

const makeClient = (cluster: string) =>
  createClient().use(
    walletSigner({
      chain: `solana:${cluster}`,
      storageKey: `attendback-${cluster}`,
    }),
  );
type AppContext = {
  config: Config;
  wallet: string | null;
  me: Dashboard | null;
  refresh: () => Promise<void>;
  login: () => void;
  transact: (path: string, data: object) => Promise<void>;
  busy: boolean;
  notice: string;
  report: (text: string) => void;
};
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw new Error('Missing provider');
  return c;
}
export function Providers({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState('');
  const load = () =>
    api<Config>('config')
      .then(setConfig)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (!config)
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-3xl font-semibold">AttendBack</h1>
        <p role="status" className="my-6">
          {error || 'Подключаемся к AttendBack…'}
        </p>
        {error && (
          <Button
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Повторить подключение
          </Button>
        )}
      </main>
    );
  return <WalletProvider config={config}>{children}</WalletProvider>;
}
function WalletProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: Config;
}) {
  const client = useMemo(() => makeClient(config.cluster), [config.cluster]);
  const connected = useConnectedWallet(client),
    wallets = useWallets(client);
  const [me, setMe] = useState<Dashboard | null>(null),
    [walletOpen, setWalletOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [prepared, setPrepared] = useState<Prepared | null>(null);
  const decision = useRef<((v: boolean) => void) | null>(null);
  const lock = useRef(false);
  const wallet = connected?.account.address ?? null;
  const refresh = async () => {
    try {
      const d = await api<Dashboard>('me');
      setMe(
        d.wallet === client.wallet.getState().connected?.account.address
          ? d
          : null,
      );
    } catch {
      setMe(null);
    }
  };
  useEffect(() => {
    if (config.cluster === 'localnet')
      void import('../lib/local-wallet').then((m) => m.registerLocalWallets());
    return () => {
      client[Symbol.dispose]();
    };
  }, [client, config.cluster]);
  useEffect(() => {
    setMe(null);
    void refresh();
  }, [wallet]);
  const authenticate = async () => {
    const account = client.wallet.getState().connected?.account;
    if (!account) throw new Error('Подключите кошелёк');
    const challenge = await api<{ id: string; message: string }>(
      'auth/challenge',
      { wallet: account.address },
    );
    setNotice('Подтвердите вход подписью сообщения в кошельке.');
    const sig = await client.wallet.signMessage(
      new TextEncoder().encode(challenge.message),
    );
    await api('auth/verify', {
      id: challenge.id,
      signature: to64(new Uint8Array(sig)),
    });
    await refresh();
    setWalletOpen(false);
    setNotice('Вход выполнен. Подпись сообщения не переводит средства.');
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Действие не завершено');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const transact = async (path: string, data: object) => {
    if (lock.current) throw new Error('Дождитесь текущей операции');
    const c = client.wallet.getState().connected;
    if (!c || !me || me.wallet !== c.account.address) {
      setWalletOpen(true);
      throw new Error('Войдите через кошелёк, затем повторите действие');
    }
    const signer = c.signer;
    if (
      !signer ||
      (!isTransactionModifyingSigner(signer) &&
        !isTransactionPartialSigner(signer))
    )
      throw new Error(
        'Нужен кошелёк с поддержкой подписи транзакций без автоматической отправки',
      );
    const version = c.supportedTransactionVersions.has(1)
      ? 1
      : c.supportedTransactionVersions.has(0)
        ? 0
        : null;
    if (version === null)
      throw new Error('Кошелёк не поддерживает транзакции v0 или v1');
    lock.current = true;
    setBusy(true);
    try {
      setNotice('Проверяем условия и симулируем транзакцию…');
      const p = await api<Prepared>(path, { ...data, version });
      setPrepared(p);
      const approved = await new Promise<boolean>((resolve) => {
        decision.current = resolve;
      });
      decision.current = null;
      setPrepared(null);
      if (!approved) {
        setNotice('Подпись отменена. Выданный резерв проверит сервер.');
        return;
      }
      if (
        client.wallet.getState().connected?.account.address !==
        c.account.address
      )
        throw new Error('Кошелёк сменился. Подготовьте операцию заново.');
      setNotice('Ожидаем подпись кошелька…');
      const tx = await signTransactionWithSigners(
        [signer],
        getTransactionDecoder().decode(from64(p.transaction)),
      );
      setNotice('Отправляем подписанную транзакцию…');
      localStorage.setItem(`attendback-intent-${c.account.address}`, p.id);
      await api(`transactions/${p.id}/submit`, {
        transaction: getBase64EncodedWireTransaction(tx),
      });
      await checkTransaction(p.id);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Транзакция не завершена');
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
      setPrepared(null);
    }
  };
  const checkTransaction = async (id: string) => {
    for (let i = 0; i < 25; i++) {
      const status = await api<{ status: string; error_code?: string }>(
        `transactions/${id}`,
      );
      if (status.status === 'finalized') {
        setNotice('Транзакция подтверждена сетью (finalized).');
        if (wallet) localStorage.removeItem(`attendback-intent-${wallet}`);
        return;
      }
      if (['failed', 'expired'].includes(status.status))
        throw new Error(
          `Операция ${status.status === 'expired' ? 'истекла' : 'отклонена'}: ${status.error_code ?? 'обновите состояние перед повтором'}`,
        );
      setNotice(
        'Транзакция отправлена. Ожидаем окончательное подтверждение сети…',
      );
      await new Promise((r) => setTimeout(r, 1200));
    }
    setNotice(
      'Подтверждение ещё не получено. Используйте «Проверить транзакцию»; повторный платёж не требуется.',
    );
  };
  return (
    <ClientProvider client={client}>
      <Context.Provider
        value={{
          config,
          wallet,
          me,
          refresh,
          login: () => setWalletOpen(true),
          transact,
          busy,
          notice,
          report: setNotice,
        }}
      >
        {children}
        <div className="notice" role="status" aria-live="polite">
          {notice && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{notice}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotice('')}
                aria-label="Скрыть уведомление"
              >
                Закрыть
              </Button>
            </div>
          )}
        </div>
        <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Кошелёк AttendBack</DialogTitle>
              <DialogDescription>
                Сеть {config.cluster}. Для входа подпишите одноразовое
                сообщение. Средства остаются под контролем кошелька.
              </DialogDescription>
            </DialogHeader>
            {connected && (
              <>
                <p className="break-all font-mono text-xs">{wallet}</p>
                <Button disabled={busy} onClick={() => void run(authenticate)}>
                  Подписать вход
                </Button>
                {me && config.cluster === 'localnet' && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api('local/fund', {});
                        setNotice(
                          'Локальный тестовый баланс пополнен. Эти токены не имеют стоимости.',
                        );
                      })
                    }
                  >
                    Получить тестовые токены
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('auth/logout', {});
                      await client.wallet.disconnect();
                      setMe(null);
                    })
                  }
                >
                  Отключить кошелёк
                </Button>
              </>
            )}
            <div className="grid gap-2">
              {wallets.map((w) => (
                <Button
                  key={w.name}
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await client.wallet.connect(w);
                      await authenticate();
                    })
                  }
                >
                  {w.name}
                </Button>
              ))}
            </div>
            {!wallets.length && (
              <p>
                Совместимый кошелёк не найден. Установите кошелёк Wallet
                Standard с поддержкой Solana {config.cluster} и обновите
                страницу.
              </p>
            )}
            {config.cluster === 'localnet' && (
              <p className="text-xs text-muted-foreground">
                «Тест» — общедоступные одноразовые роли только для локальной
                демонстрации. Не переводите на них реальные средства.
              </p>
            )}
            {wallet && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const id = localStorage.getItem(
                      `attendback-intent-${wallet}`,
                    );
                    if (!id) throw new Error('Нет сохранённой операции');
                    await checkTransaction(id);
                    await refresh();
                  })
                }
              >
                Проверить транзакцию
              </Button>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!prepared}
          onOpenChange={(open) => {
            if (!open) decision.current?.(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Подтвердите действие</DialogTitle>
              <DialogDescription>
                Симуляция прошла. Проверьте условия до подписи в кошельке.
              </DialogDescription>
            </DialogHeader>
            {prepared && (
              <dl className="review-grid">
                <dt>Действие</dt>
                <dd>
                  {actionLabels[prepared.summary.action] ??
                    prepared.summary.action}
                </dd>
                <dt>Залог</dt>
                <dd>
                  {displayAmount(prepared.summary.principal)} тестовых USDC
                </dd>
                <dt>Удержание при неявке</dt>
                <dd>{prepared.summary.penaltyBps / 100}%</dd>
                <dt>Сеть</dt>
                <dd>{prepared.summary.cluster}</dd>
                <dt>Плательщик комиссии</dt>
                <dd title={prepared.summary.feePayer}>
                  {short(prepared.summary.feePayer)}
                </dd>
                <dt>Получатель удержания</dt>
                <dd className="break-all text-xs">
                  {prepared.summary.penaltyRecipient}
                </dd>
                <dt>Mint</dt>
                <dd className="break-all text-xs">{prepared.summary.mint}</dd>
                <dt>Комиссия</dt>
                <dd>{prepared.summary.fees}</dd>
              </dl>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => decision.current?.(false)}
              >
                Отмена
              </Button>
              <Button onClick={() => decision.current?.(true)}>
                Подписать транзакцию
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Context.Provider>
    </ClientProvider>
  );
}
export const actionLabels: Record<string, string> = {
  publish: 'Опубликовать неизменяемые условия',
  deposit: 'Внести залог',
  cancel: 'Отменить участие',
  settle: 'Выполнить расчёт',
  timeout: 'Защитный возврат',
  dispute: 'Открыть спор в сети',
  resolve_refund: 'Решить спор: вернуть залог',
  resolve_forfeit: 'Решить спор: применить удержание',
  cancel_event: 'Отменить событие для всех участников',
};
