import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createClient,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  signTransactionWithSigners,
  signature,
} from '@solana/kit';
import { walletSigner } from '@solana/kit-plugin-wallet';
import {
  useWallets,
  useConnectedWallet,
} from '@solana/kit-plugin-wallet/react';
import { connection, readDeposit, prepareRefund } from './recovery';
import { displayAmount } from '../../../packages/domain/src';
import './style.css';
function App() {
  const [cluster, setCluster] = useState('localnet'),
    [url, setUrl] = useState('http://127.0.0.1:8899'),
    [deposit, setDeposit] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<Awaited<ReturnType<typeof readDeposit>>>(),
    [prepared, setPrepared] =
      useState<Awaited<ReturnType<typeof prepareRefund>>>();
  const client = useMemo(
      () =>
        createClient().use(
          walletSigner({
            chain: `solana:${cluster}`,
            storageKey: `attendback-recovery-${cluster}`,
          }),
        ),
      [cluster],
    ),
    wallets = useWallets(client),
    connected = useConnectedWallet(client);
  useEffect(() => {
    if (cluster === 'localnet')
      void import('../../web/lib/local-wallet').then((m) =>
        m.registerLocalWallets(),
      );
  }, [cluster]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('Проверяем сеть…');
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    setPrepared(undefined);
    const s = await readDeposit(cluster, url, deposit);
    setState(s);
    setMessage(
      s.allowed
        ? 'Полный возврат доступен.'
        : 'Сейчас полный возврат недоступен либо расчёт уже завершён.',
    );
  };
  const check = async () => {
    const sig = localStorage.getItem(
      `attendback-recovery-signature-${deposit}`,
    );
    if (!sig) throw new Error('Сохранённая подпись не найдена');
    const s = await connection(cluster, url)
      .getSignatureStatuses([signature(sig)], {
        searchTransactionHistory: true,
      })
      .send();
    if (s.value[0]?.err) throw new Error('Транзакция отклонена сетью');
    setMessage(
      s.value[0]?.confirmationStatus === 'finalized'
        ? `Возврат подтверждён (finalized): ${sig}`
        : `Подтверждение ещё не получено: ${sig}`,
    );
    setState(await readDeposit(cluster, url, deposit));
  };
  return (
    <main>
      <p className="eyebrow">
        AttendBack · {cluster} · только тестовые средства
      </p>
      <h1>Резервный возврат</h1>
      <p>
        Эта страница работает напрямую с Solana RPC. Сервер и база AttendBack не
        нужны. Получатель зафиксирован в депозите; подключённый кошелёк
        оплачивает только комиссию.
      </p>
      <section>
        <label>
          Сеть
          <select
            value={cluster}
            disabled={busy}
            onChange={(e) => {
              setCluster(e.target.value);
              setUrl(
                e.target.value === 'devnet'
                  ? 'https://api.devnet.solana.com'
                  : 'http://127.0.0.1:8899',
              );
              setState(undefined);
              setPrepared(undefined);
            }}
          >
            <option value="localnet">Localnet</option>
            <option value="devnet">Devnet</option>
          </select>
        </label>
        <label>
          Адрес RPC
          <input
            type="url"
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setState(undefined);
              setPrepared(undefined);
            }}
          />
        </label>
        <label>
          Адрес депозита
          <input
            value={deposit}
            disabled={busy}
            onChange={(e) => {
              setDeposit(e.target.value.trim());
              setState(undefined);
              setPrepared(undefined);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button disabled={busy || !deposit} onClick={() => void run(inspect)}>
          Проверить депозит
        </button>
      </section>
      <section>
        <h2>Кошелёк для комиссии</h2>
        {connected && <p className="mono">{connected.account.address}</p>}
        <div className="buttons">
          {wallets.map((w) => (
            <button
              key={w.name}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.wallet.connect(w);
                  setPrepared(undefined);
                  setMessage('Кошелёк подключён.');
                })
              }
            >
              {w.name}
            </button>
          ))}
        </div>
        {!wallets.length && (
          <p>Подключите совместимый кошелёк Wallet Standard.</p>
        )}
      </section>
      {state && (
        <section>
          <h2>Проверенные условия</h2>
          <dl>
            <dt>Получатель возврата</dt>
            <dd className="mono">{state.c.guest}</dd>
            <dt>Залог</dt>
            <dd>{displayAmount(state.c.principal)} тестовых USDC</dd>
            <dt>Mint</dt>
            <dd className="mono">{state.p.mint}</dd>
            <dt>Защитный срок</dt>
            <dd>
              {new Date(
                Number(state.p.terms.hardRefundAt) * 1000,
              ).toLocaleString('ru-RU')}
            </dd>
            <dt>Уже возвращено</dt>
            <dd>{displayAmount(state.c.refund)} USDC</dd>
          </dl>
          <button
            disabled={busy || !state.allowed || !connected}
            onClick={() =>
              void run(async () => {
                if (!connected) throw new Error('Подключите кошелёк');
                const version = connected.supportedTransactionVersions.has(1)
                  ? 1
                  : connected.supportedTransactionVersions.has(0)
                    ? 0
                    : null;
                if (version === null)
                  throw new Error('Кошелёк не поддерживает v0/v1');
                setPrepared(
                  await prepareRefund(
                    cluster,
                    url,
                    deposit,
                    connected.account.address,
                    version,
                  ),
                );
                setMessage(
                  'Симуляция прошла. Проверьте получателя и подпишите возврат.',
                );
              })
            }
          >
            Подготовить возврат
          </button>
        </section>
      )}
      {prepared && (
        <section className="confirm">
          <h2>Подтвердите возврат</h2>
          <p>
            Вернуть {displayAmount(prepared.state.c.principal)} тестовых USDC в
            сети {prepared.cluster} на кошелёк:
          </p>
          <p className="mono">{prepared.state.c.guest}</p>
          <p>Плательщик комиссии и хранения аккаунтов:</p>
          <p className="mono">{prepared.feePayer}</p>
          <div className="buttons">
            <button disabled={busy} onClick={() => setPrepared(undefined)}>
              Отмена
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const signer = client.wallet.getState().connected?.signer;
                  if (
                    !signer ||
                    signer.address !== prepared.feePayer ||
                    (!isTransactionModifyingSigner(signer) &&
                      !isTransactionPartialSigner(signer))
                  )
                    throw new Error(
                      'Кошелёк изменился или не поддерживает подпись',
                    );
                  const signed = await signTransactionWithSigners(
                    [signer],
                    prepared.tx,
                  );
                  if (
                    signed.messageBytes.length !==
                      prepared.tx.messageBytes.length ||
                    signed.messageBytes.some(
                      (x, i) => x !== prepared.tx.messageBytes[i],
                    )
                  )
                    throw new Error('Кошелёк изменил транзакцию');
                  const sig = getSignatureFromTransaction(signed);
                  localStorage.setItem(
                    `attendback-recovery-signature-${deposit}`,
                    sig,
                  );
                  setPrepared(undefined);
                  await connection(prepared.cluster, prepared.url)
                    .sendTransaction(getBase64EncodedWireTransaction(signed), {
                      encoding: 'base64',
                      skipPreflight: false,
                      preflightCommitment: 'confirmed',
                      maxRetries: 3n,
                    })
                    .send();
                  setMessage(
                    'Возврат отправлен. Проверьте подтверждение сети.',
                  );
                })
              }
            >
              Подписать возврат
            </button>
          </div>
        </section>
      )}
      <p role="status" className="message">
        {message}
      </p>
      <button disabled={busy || !deposit} onClick={() => void run(check)}>
        Проверить подтверждение
      </button>
      <p className="small">
        Если RPC недоступен, выберите другой RPC той же сети. Страница не может
        ускорить защитный срок или заменить решение арбитра. Исходный код и IDL
        нужно распространять вместе с релизом.
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
