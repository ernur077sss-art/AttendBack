import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createSolanaRpc, address } from '@solana/kit';
import { fetchMint, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { PROGRAM_ADDRESS } from '../packages/chain-client/src';
async function main() {
  const binary = await readFile('target/deploy/attendback.so'),
    idl = await readFile('idl/attendback.json');
  if (JSON.parse(idl.toString()).address !== PROGRAM_ADDRESS)
    throw new Error('IDL program address mismatch');
  const rpcUrl = 'https://api.devnet.solana.com',
    rpc = createSolanaRpc(rpcUrl),
    genesis = await rpc
      .getGenesisHash()
      .send({ abortSignal: AbortSignal.timeout(15000) });
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
    throw new Error('Unexpected devnet genesis');
  const mintAddress = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const mint = await fetchMint(rpc, mintAddress, {
    commitment: 'finalized',
    abortSignal: AbortSignal.timeout(15000),
  });
  if (
    mint.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    mint.data.decimals !== 6 ||
    !mint.data.isInitialized
  )
    throw new Error('Unexpected devnet mint owner or decimals');
  const rent = async (bytes: number) =>
    (
      await rpc
        .getMinimumBalanceForRentExemption(BigInt(bytes))
        .send({ abortSignal: AbortSignal.timeout(15000) })
    ).toString();
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    network: 'devnet',
    rpcUrl,
    genesis,
    programId: PROGRAM_ADDRESS,
    programBytes: binary.length,
    programSha256: createHash('sha256').update(binary).digest('hex'),
    idlSha256: createHash('sha256').update(idl).digest('hex'),
    mint: mintAddress,
    mintDecimals: mint.data.decimals,
    mintOwner: mint.programAddress,
    deployment: 'not_performed',
    rentEstimateLamports: {
      programAccount: await rent(36),
      programDataAtDoubleCapacity: await rent(45 + binary.length * 2),
      temporaryBuffer: await rent(37 + binary.length),
    },
    rentNotes:
      'Read-only estimate for upgradeable loader with max length twice the binary. Temporary buffer rent is recovered after successful deployment; transaction fees are additional. Test SOL only.',
    feePayer: null,
    upgradeAuthority: null,
    bookingAuthority: null,
    attester: null,
    workerPayer: null,
    webUrl: null,
    recoveryUrl: null,
    hostingCost: 'not_selected',
  };
  await writeFile(
    'docs/release-manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    'Read-only devnet release manifest written. No transaction was signed or sent.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
