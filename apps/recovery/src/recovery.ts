import {
  address,
  createSolanaRpc,
  createClient,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  setTransactionMessageConfig,
} from '@solana/kit';
import { signer } from '@solana/kit-plugin-signer';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { fetchSysvarClock } from '@solana/sysvars';
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token';
import * as program from '../../../packages/chain-client/src';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export function connection(cluster: string, url: string) {
  const parsed = new URL(url);
  if (
    cluster === 'localnet' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  )
    throw new Error('Localnet требует локальный RPC');
  if (
    !['localnet', 'devnet'].includes(cluster) ||
    (cluster === 'devnet' && parsed.protocol !== 'https:')
  )
    throw new Error('Разрешены только localnet и devnet HTTPS');
  return createSolanaRpc(url);
}
export async function readDeposit(
  cluster: string,
  url: string,
  deposit: string,
) {
  const rpc = connection(cluster, url);
  if (
    cluster === 'devnet' &&
    (await rpc
      .getGenesisHash()
      .send({ abortSignal: AbortSignal.timeout(15000) })) !== DEVNET_GENESIS
  )
    throw new Error('RPC подключён не к devnet');
  const read = async (addr: Address, size: number, disc: ArrayLike<number>) => {
    const info = await rpc
      .getAccountInfo(addr, { encoding: 'base64', commitment: 'finalized' })
      .send({ abortSignal: AbortSignal.timeout(15000) });
    if (!info.value || info.value.owner !== program.PROGRAM_ADDRESS)
      throw new Error('Аккаунт отсутствует или принадлежит другой программе');
    const data = Uint8Array.from(atob(info.value.data[0]), (x) =>
      x.charCodeAt(0),
    );
    if (data.length !== size || Array.from(disc).some((n, i) => n !== data[i]))
      throw new Error('Неверный формат аккаунта');
    return data;
  };
  const addr = address(deposit);
  const c = program
    .getCommitmentDecoder()
    .decode(
      await read(
        addr,
        program.getCommitmentSize(),
        program.getCommitmentDiscriminatorBytes(),
      ),
    );
  const p = program
    .getPolicyDecoder()
    .decode(
      await read(
        c.policy,
        program.getPolicySize(),
        program.getPolicyDiscriminatorBytes(),
      ),
    );
  const e = program
    .getEventRecordDecoder()
    .decode(
      await read(
        p.event,
        program.getEventRecordSize(),
        program.getEventRecordDiscriminatorBytes(),
      ),
    );
  if (
    (await program.commitmentPda(c.policy, c.guest)) !== addr ||
    c.principal !== p.terms.amount
  )
    throw new Error('Связи депозита не совпадают');
  const mint =
    cluster === 'devnet'
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : '32c76PQ6uXRcRH8Lryq92QVCYup4Ysapqx3Mui4HTzUN';
  if (p.mint !== mint || p.decimals !== 6)
    throw new Error('Mint не соответствует тестовому USDC');
  const clock = await fetchSysvarClock(rpc, { commitment: 'finalized' }),
    now = clock.unixTimestamp;
  const allowed =
    c.status !== program.DepositStatus.Settled &&
    (e.cancelled ||
      c.status === program.DepositStatus.Refundable ||
      now >= p.terms.hardRefundAt);
  return { addr, c, p, e, allowed, now };
}
export async function prepareRefund(
  cluster: string,
  url: string,
  deposit: string,
  payerAddress: string,
  version: 0 | 1,
) {
  const state = await readDeposit(cluster, url, deposit);
  if (!state.allowed)
    throw new Error('Полный возврат пока недоступен по условиям программы');
  const payer = createNoopSigner(address(payerAddress));
  const ata = async (owner: Address) =>
    (
      await findAssociatedTokenPda({
        owner,
        mint: state.p.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
    )[0];
  const guestTokens = await ata(state.c.guest),
    penaltyTokens = await ata(state.p.terms.penaltyRecipient);
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: guestTokens,
      owner: state.c.guest,
      mint: state.p.mint,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: penaltyTokens,
      owner: state.p.terms.penaltyRecipient,
      mint: state.p.mint,
    }),
    program.getSettleInstruction({
      event: state.p.event,
      policy: state.c.policy,
      commitment: state.addr,
      vault: await program.vaultPda(state.addr),
      guestTokens,
      penaltyTokens,
      mint: state.p.mint,
    }),
  ];
  const client = createClient()
    .use(signer(payer))
    .use(solanaRpc({ rpcUrl: url, transactionConfig: { version } }));
  const input =
    cluster === 'localnet' && version === 1
      ? pipe(
          createTransactionMessage({ version: 1 }),
          (m) => setTransactionMessageFeePayerSigner(payer, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
          (m) =>
            setTransactionMessageConfig(
              { loadedAccountsDataSizeLimit: 1048576 },
              m,
            ),
        )
      : instructions;
  const plan = await client.signTransaction(input);
  const tx = plan.context.transaction;
  const sim = await client.rpc
    .simulateTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: 'base64',
      sigVerify: false,
      commitment: 'confirmed',
    })
    .send({ abortSignal: AbortSignal.timeout(15000) });
  if (sim.value.err)
    throw new Error(
      'Симуляция возврата отклонена. Проверьте SOL для комиссии и повторите чтение.',
    );
  return { state, tx, feePayer: payerAddress, cluster, url };
}
