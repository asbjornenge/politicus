import { InMemorySigner } from '@taquito/signer';
import { b58cencode, prefix } from '@taquito/utils';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, '.env');

if (existsSync(envPath)) {
  const existing = readFileSync(envPath, 'utf8');
  if (/POLITICUS_PRIVATE_KEY=\s*edsk\w/.test(existing)) {
    console.error('.env already contains a private key. Refusing to overwrite.');
    console.error('If you really want a new key, delete .env first.');
    process.exit(1);
  }
}

const seed = randomBytes(32);
const sk = b58cencode(seed, prefix.edsk2);

const signer = await InMemorySigner.fromSecretKey(sk);
const pkh = await signer.publicKeyHash();
const pk = await signer.publicKey();

const env = `# Generated ${new Date().toISOString()} by scripts/generate-keypair.mjs
# DO NOT COMMIT THIS FILE. It contains a private key.
POLITICUS_PRIVATE_KEY=${sk}
POLITICUS_PUBLIC_KEY=${pk}
POLITICUS_ADDRESS=${pkh}
POLITICUS_FAUCET_URL=https://faucet.shadownet.teztnets.com
POLITICUS_NETWORK=shadownet
`;

writeFileSync(envPath, env, { mode: 0o600 });

console.log('New keypair generated and written to .env (mode 0600).');
console.log(`  Address:    ${pkh}`);
console.log(`  Public key: ${pk}`);
console.log('  Private key stored in .env — never share, never commit.');
console.log('');
console.log('Next: npm run fund');
