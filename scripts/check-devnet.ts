import { address, createSolanaRpc } from '@solana/kit';
async function main() {
  const required = [
    'DATABASE_URL',
    'APP_ORIGIN',
    'SOLANA_CLUSTER',
    'SOLANA_RPC_URL',
    'SOLANA_EXPECTED_GENESIS_HASH',
    'SERVICE_SIGNER_URL',
    'SERVICE_SIGNER_TOKEN',
    'SIGNER_BOOKING_ADDRESS',
    'SIGNER_ATTESTER_ADDRESS',
    'SIGNER_PAYER_ADDRESS',
    'DEPLOY_FEE_PAYER_ADDRESS',
    'PROGRAM_UPGRADE_AUTHORITY_ADDRESS',
    'NEXT_PUBLIC_RECOVERY_URL',
  ];
  const missing = required.filter(
    (k) => !process.env[k] || /replace|secret-manager/.test(process.env[k]!),
  );
  if (missing.length)
    throw new Error(`Set deployment configuration: ${missing.join(', ')}`);
  if (process.env.SOLANA_CLUSTER !== 'devnet')
    throw new Error('This check only accepts devnet');
  for (const key of [
    'APP_ORIGIN',
    'SOLANA_RPC_URL',
    'SERVICE_SIGNER_URL',
    'NEXT_PUBLIC_RECOVERY_URL',
  ]) {
    const url = new URL(process.env[key]!);
    if (url.protocol !== 'https:' || url.hostname.endsWith('.invalid'))
      throw new Error(`${key} needs a configured HTTPS endpoint`);
  }
  for (const key of [
    'SIGNER_BOOKING_ADDRESS',
    'SIGNER_ATTESTER_ADDRESS',
    'SIGNER_PAYER_ADDRESS',
    'DEPLOY_FEE_PAYER_ADDRESS',
    'PROGRAM_UPGRADE_AUTHORITY_ADDRESS',
  ])
    address(process.env[key]!);
  if (
    new Set(
      [
        'SIGNER_BOOKING_ADDRESS',
        'SIGNER_ATTESTER_ADDRESS',
        'SIGNER_PAYER_ADDRESS',
      ].map((k) => process.env[k]),
    ).size !== 3
  )
    throw new Error('Use three separate service roles');
  const genesis = await createSolanaRpc(process.env.SOLANA_RPC_URL!)
    .getGenesisHash()
    .send({ abortSignal: AbortSignal.timeout(15000) });
  if (
    genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' ||
    genesis !== process.env.SOLANA_EXPECTED_GENESIS_HASH
  )
    throw new Error('Devnet genesis mismatch');
  console.log(
    'Devnet configuration shape and RPC genesis verified. Signer service, deployment and HTTPS flows still require end-to-end validation. No signatures requested.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
