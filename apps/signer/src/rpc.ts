import {
  createSolanaRpc,
  type Address,
  type Base64EncodedWireTransaction,
  type TransactionMessageBytesBase64,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { fetchSysvarClock } from '@solana/sysvars';
import { fetchMint, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { PROGRAM_ADDRESS } from '../../../packages/chain-client/src';
import {
  DEVNET_GENESIS,
  DEVNET_MINT,
  SigningDenied,
  type SignerChain,
} from './policy';
const timeout = () => ({ abortSignal: AbortSignal.timeout(12000) });
export function devnetChain(url: string): SignerChain {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
    throw new SigningDenied('RPC_CONFIG');
  const rpc = createSolanaRpc(url);
  return {
    async verifyNetwork() {
      const genesis = await rpc.getGenesisHash().send(timeout());
      if (genesis !== DEVNET_GENESIS) throw new SigningDenied('NETWORK');
      const program = await rpc
        .getAccountInfo(PROGRAM_ADDRESS, {
          encoding: 'base64',
          commitment: 'finalized',
        })
        .send(timeout());
      if (
        !program.value?.executable ||
        program.value.owner !== 'BPFLoaderUpgradeab1e11111111111111111111111'
      )
        throw new SigningDenied('PROGRAM');
      const mint = await fetchMint(rpc, DEVNET_MINT, {
        commitment: 'finalized',
        ...timeout(),
      });
      if (
        mint.programAddress !== TOKEN_PROGRAM_ADDRESS ||
        !mint.data.isInitialized ||
        mint.data.decimals !== 6
      )
        throw new SigningDenied('MINT');
    },
    async account(key: Address) {
      const result = await rpc
        .getAccountInfo(key, { encoding: 'base64', commitment: 'finalized' })
        .send(timeout());
      return result.value
        ? {
            owner: result.value.owner,
            executable: result.value.executable,
            data: Buffer.from(result.value.data[0], 'base64'),
          }
        : null;
    },
    async time() {
      return (
        await fetchSysvarClock(rpc, { commitment: 'finalized', ...timeout() })
      ).unixTimestamp;
    },
    async fee(message: ReadonlyUint8Array) {
      const result = await rpc
        .getFeeForMessage(
          Buffer.from(message).toString(
            'base64',
          ) as TransactionMessageBytesBase64,
          { commitment: 'confirmed' },
        )
        .send(timeout());
      if (result.value === null) throw new SigningDenied('BLOCKHASH');
      return result.value;
    },
    async simulate(wire: string) {
      const result = await rpc
        .simulateTransaction(wire as Base64EncodedWireTransaction, {
          encoding: 'base64',
          commitment: 'confirmed',
          sigVerify: false,
        })
        .send(timeout());
      if (result.value.err) throw new SigningDenied('SIMULATION');
    },
  };
}
