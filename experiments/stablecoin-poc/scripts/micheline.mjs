// Minimal Micheline binary-format encoders. Enough for our PoC payloads:
// strings, bytes, nats (signed-zarith), Pairs, Options (None only), and
// helpers that convert a tz1/KT1 base58 address to its 22-byte optimised
// binary form.

import pkg from '@taquito/utils';
const { b58DecodeAndCheckPrefix, PrefixV2 } = pkg;

function decodeHash(addr, prefixEnum) {
  const [data] = b58DecodeAndCheckPrefix(addr, [prefixEnum]);
  return Buffer.from(data);
}

export function encString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32BE(buf.length);
  return Buffer.concat([Buffer.from('01', 'hex'), len, buf]);
}

export function encBytes(buf) {
  const len = Buffer.alloc(4); len.writeUInt32BE(buf.length);
  return Buffer.concat([Buffer.from('0a', 'hex'), len, buf]);
}

export function encNat(n) {
  if (n === 0n || n === 0) return Buffer.from('0000', 'hex');
  let v = typeof n === 'bigint' ? n : BigInt(n);
  const out = [];
  // First byte: 6 magnitude bits + sign(0) + continuation
  let first = Number(v & 0x3fn);
  v >>= 6n;
  if (v > 0n) first |= 0x80;
  out.push(first);
  // Subsequent: 7 magnitude bits + continuation
  while (v > 0n) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  }
  return Buffer.concat([Buffer.from('00', 'hex'), Buffer.from(out)]);
}

/// Right-associate: Pair a (Pair b (Pair c d))
export function encPair(...parts) {
  let acc = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    acc = Buffer.concat([Buffer.from('0707', 'hex'), parts[i], acc]);
  }
  return acc;
}

export const NONE = Buffer.from('0306', 'hex');

/// Convert a tz1/2/3/KT1 base58 address into its 22-byte optimised binary
/// form (Tezos `address` PACK shape):
///   tz1 → 0x0000 + 20-byte hash
///   tz2 → 0x0001 + 20-byte hash
///   tz3 → 0x0002 + 20-byte hash
///   KT1 → 0x01   + 20-byte hash + 0x00
export function addressToBytes22(addrStr) {
  if (addrStr.startsWith('tz1')) {
    return Buffer.concat([Buffer.from('0000', 'hex'), decodeHash(addrStr, PrefixV2.Ed25519PublicKeyHash)]);
  }
  if (addrStr.startsWith('tz2')) {
    return Buffer.concat([Buffer.from('0001', 'hex'), decodeHash(addrStr, PrefixV2.Secp256k1PublicKeyHash)]);
  }
  if (addrStr.startsWith('tz3')) {
    return Buffer.concat([Buffer.from('0002', 'hex'), decodeHash(addrStr, PrefixV2.P256PublicKeyHash)]);
  }
  if (addrStr.startsWith('KT1')) {
    const hash = decodeHash(addrStr, PrefixV2.ContractHash);
    return Buffer.concat([Buffer.from('01', 'hex'), hash, Buffer.from('00', 'hex')]);
  }
  throw new Error(`unsupported address prefix: ${addrStr}`);
}
