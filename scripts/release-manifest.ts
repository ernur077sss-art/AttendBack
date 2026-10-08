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
  const rent = (bytes: number) =>
    rpc
      .getMinimumBalanceForRentExemption(BigInt(bytes))
      .send({ abortSignal: AbortSignal.timeout(15000) });
  const [programRent, programDataRent, bufferRent] = await Promise.all([
    rent(36),
    rent(45 + binary.length),
    rent(37 + binary.length),
  ]);
  const peakAccountFunding = programRent + programDataRent;
  const initialFundingTarget =
    ((peakAccountFunding + 250_000_000n + 999_999_999n) / 1_000_000_000n) *
    1_000_000_000n;
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
    programMaxLengthBytes: binary.length,
    rentEstimateLamports: {
      programAccount: programRent.toString(),
      programData: programDataRent.toString(),
      temporaryBufferMinimum: bufferRent.toString(),
      initialBufferFunding: programDataRent.toString(),
      peakAccountFunding: peakAccountFunding.toString(),
    },
    initialFundingTargetLamports: initialFundingTarget.toString(),
    rentNotes:
      'Read-only estimate for a new deployment with --max-len equal to programMaxLengthBytes. Agave 4.3.0 funds the buffer with the ProgramData rent, then the loader returns those lamports to the payer before creating ProgramData. Do not add buffer rent a second time. Transaction fees, retries, service funding and future program growth are additional; the funding target is a reserve, not a measured deployment cost. Test SOL only.',
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
