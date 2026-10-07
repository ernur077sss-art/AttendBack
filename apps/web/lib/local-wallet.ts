// Public, disposable test identities. Never register them on devnet or a hosted origin.
import { registerWallet } from '@wallet-standard/wallet';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
} from '@solana/kit';
let registered = false;
export async function registerLocalWallets() {
  if (registered || !['127.0.0.1', 'localhost'].includes(location.hostname))
    return;
  registered = true;
  for (const [role, label] of [
    ['owner', 'Организатор'],
    ['guest', 'Участник'],
    ['guest2', 'Участник 2'],
    ['staff', 'Сотрудник'],
    ['resolver', 'Арбитр'],
  ]) {
    const seed = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`AttendBack local test only: ${role}`),
      ),
    );
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const account = {
      address: signer.address,
      publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
      chains: ['solana:localnet'] as const,
      features: ['solana:signMessage', 'solana:signTransaction'] as const,
      label,
    };
    let connected = false;
    const listeners = new Set<(p: { accounts: (typeof account)[] }) => void>();
    const changed = () =>
      listeners.forEach((fn) => fn({ accounts: connected ? [account] : [] }));
    registerWallet({
      version: '1.0.0',
      name: `Тест · ${label}`,
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzE3MTcxNyIvPjxwYXRoIGQ9Ik04IDI0IDE2IDhsOCAxNk0xMiAxOGg4IiBzdHJva2U9IndoaXRlIiBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IjMiLz48L3N2Zz4=',
      chains: ['solana:localnet'],
      get accounts() {
        return connected ? [account] : [];
      },
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => {
            connected = true;
            changed();
            return { accounts: [account] };
          },
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: async () => {
            connected = false;
            changed();
          },
        },
        'standard:events': {
          version: '1.0.0',
          on: (
            event: string,
            fn: (p: { accounts: (typeof account)[] }) => void,
          ) => {
            if (event === 'change') listeners.add(fn);
            return () => listeners.delete(fn);
          },
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (...inputs: { message: Uint8Array }[]) =>
            Promise.all(
              inputs.map(async (i) => ({
                signedMessage: i.message,
                signature: new Uint8Array(
                  await crypto.subtle.sign(
                    'Ed25519',
                    signer.keyPair.privateKey,
                    i.message as Uint8Array<ArrayBuffer>,
                  ),
                ),
              })),
            ),
        },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: [0, 1],
          signTransaction: async (
            ...inputs: { transaction: Uint8Array; chain: string }[]
          ) =>
            Promise.all(
              inputs.map(async (i) => {
                if (i.chain !== 'solana:localnet')
                  throw new Error('Только localnet');
                return {
                  signedTransaction: new Uint8Array(
                    getTransactionEncoder().encode(
                      await partiallySignTransaction(
                        [signer.keyPair],
                        getTransactionDecoder().decode(i.transaction),
                      ),
                    ),
                  ),
                };
              }),
            ),
        },
      },
    });
  }
}
