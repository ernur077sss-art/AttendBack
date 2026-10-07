import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit';
export * from './generated';
export const PROGRAM_ADDRESS = address(
  '6CUM27mNoskjKnCsoywCQz4puZfhpXj5DJWEDZJuiwuV',
);
const encoder = getAddressEncoder();
const seed = (value: string) => new TextEncoder().encode(value);
export function idBytes(id: string) {
  const bytes = new TextEncoder().encode(id.replaceAll('-', ''));
  if (bytes.length !== 32) throw new Error('Expected UUID');
  return bytes;
}
export async function eventPda(authority: Address, id: Uint8Array) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS,
      seeds: [seed('event'), encoder.encode(authority), id],
    })
  )[0];
}
export async function policyPda(event: Address, id: Uint8Array) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS,
      seeds: [seed('policy'), encoder.encode(event), id],
    })
  )[0];
}
export async function commitmentPda(policy: Address, guest: Address) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS,
      seeds: [
        seed('commitment'),
        encoder.encode(policy),
        encoder.encode(guest),
      ],
    })
  )[0];
}
export async function vaultPda(commitment: Address) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS,
      seeds: [seed('vault'), encoder.encode(commitment)],
    })
  )[0];
}
