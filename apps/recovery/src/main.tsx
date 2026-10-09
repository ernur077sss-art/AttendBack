import {
  useI18n,
  LanguageProvider,
  LanguageSwitcher,
} from '../../../packages/i18n/react';
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
import { intlLocale } from '../../../packages/i18n';
import './style.css';
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(
  window.location.hostname,
);
function App() {
  const { t, locale, message: localizeMessage } = useI18n();

  useEffect(() => {
    document.title = `AttendBack — ${t('Резервный возврат')}`;
  }, [t]);
  const [cluster, setCluster] = useState(isLocalHost ? 'localnet' : 'devnet'),
    [url, setUrl] = useState(
      isLocalHost ? 'http://127.0.0.1:8899' : 'https://api.devnet.solana.com',
    ),
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
    if (isLocalHost && cluster === 'localnet')
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
      .send({ abortSignal: AbortSignal.timeout(15000) });
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
      <LanguageSwitcher />
      <p className="eyebrow">
        {t('AttendBack · {0} · только тестовые средства', [cluster])}
      </p>
      <h1>{t('Резервный возврат')}</h1>
      <p>
        {t(
          'Эта страница работает напрямую с Solana RPC. Сервер и база AttendBack не нужны. Получатель зафиксирован в депозите; подключённый кошелёк оплачивает только комиссию.',
        )}
      </p>
      <section>
        <label>
          {t('Сеть')}
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
            {isLocalHost && <option value="localnet">Localnet</option>}
            <option value="devnet">Devnet</option>
          </select>
        </label>
        <label>
          {t('Адрес RPC')}
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
          {t('Адрес депозита')}
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
          {t('Проверить депозит')}
        </button>
      </section>
      <section>
        <h2>{t('Кошелёк для комиссии')}</h2>
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
              {w.name.startsWith('Тест · ')
                ? t('Тест · {0}', [t(w.name.slice(7))])
                : w.name}
            </button>
          ))}
        </div>
        {!wallets.length && (
          <p>{t('Подключите совместимый кошелёк Wallet Standard.')}</p>
        )}
      </section>
      {state && (
        <section>
          <h2>{t('Проверенные условия')}</h2>
          <dl>
            <dt>{t('Получатель возврата')}</dt>
            <dd className="mono">{state.c.guest}</dd>
            <dt>{t('Залог')}</dt>
            <dd>
              {t('{0} тестовых USDC', [displayAmount(state.c.principal)])}
            </dd>
            <dt>Mint</dt>
            <dd className="mono">{state.p.mint}</dd>
            <dt>{t('Защитный срок')}</dt>
            <dd>
              {new Date(
                Number(state.p.terms.hardRefundAt) * 1000,
              ).toLocaleString(intlLocale(locale))}
            </dd>
            <dt>{t('Уже возвращено')}</dt>
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
            {t('Подготовить возврат')}
          </button>
        </section>
      )}
      {prepared && (
        <section className="confirm">
          <h2>{t('Подтвердите возврат')}</h2>
          <p>
            {t('Вернуть {0} тестовых USDC в сети {1} на кошелёк:', [
              displayAmount(prepared.state.c.principal),
              prepared.cluster,
            ])}
          </p>
          <p className="mono">{prepared.state.c.guest}</p>
          <p>{t('Плательщик комиссии и хранения аккаунтов:')}</p>
          <p className="mono">{prepared.feePayer}</p>
          <div className="buttons">
            <button disabled={busy} onClick={() => setPrepared(undefined)}>
              {t('Отмена')}
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
                    .send({ abortSignal: AbortSignal.timeout(15000) });
                  setMessage(
                    'Возврат отправлен. Проверьте подтверждение сети.',
                  );
                })
              }
            >
              {t('Подписать возврат')}
            </button>
          </div>
        </section>
      )}
      <p role="status" className="message">
        {localizeMessage(message)}
      </p>
      <button disabled={busy || !deposit} onClick={() => void run(check)}>
        {t('Проверить подтверждение')}
      </button>
      <p className="small">
        {t(
          'Если RPC недоступен, выберите другой RPC той же сети. Страница не может ускорить защитный срок или заменить решение арбитра. Исходный код и IDL нужно распространять вместе с релизом.',
        )}
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>,
);
