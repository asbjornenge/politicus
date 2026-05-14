import getTez from '@tacoinfra/get-tez';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(repoRoot, '.env') });

const { POLITICUS_ADDRESS, POLITICUS_FAUCET_URL } = process.env;

if (!POLITICUS_ADDRESS) {
  console.error('POLITICUS_ADDRESS missing from .env. Run `npm run generate-key` first.');
  process.exit(1);
}
if (!POLITICUS_FAUCET_URL) {
  console.error('POLITICUS_FAUCET_URL missing from .env.');
  process.exit(1);
}

const amount = Number(process.argv[2] ?? 100);
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Invalid amount: ${process.argv[2]}`);
  process.exit(1);
}

console.log(`Requesting ${amount} tez for ${POLITICUS_ADDRESS}`);
console.log(`Faucet: ${POLITICUS_FAUCET_URL}`);

const txHash = await getTez({
  address: POLITICUS_ADDRESS,
  amount,
  faucetUrl: POLITICUS_FAUCET_URL,
});

console.log(`Funded. Tx: ${txHash}`);
