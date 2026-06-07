// One-shot: generate an EVM keypair for Previewnet experiments and
// append it to the PoC .env file. Idempotent — refuses to overwrite.

import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

if (existsSync(envPath) && readFileSync(envPath, 'utf8').includes('POC_EVM_PRIVATE_KEY=')) {
  console.error(`${envPath} already has POC_EVM_PRIVATE_KEY. Refusing to overwrite.`);
  process.exit(1);
}

const wallet = ethers.Wallet.createRandom();

const lines = [
  `# Generated ${new Date().toISOString()} — DO NOT COMMIT`,
  `POC_EVM_PRIVATE_KEY=${wallet.privateKey}`,
  `POC_EVM_ADDRESS=${wallet.address}`,
  '',
  '# Endpoints (Previewnet)',
  'POC_EVM_RPC=https://evm.previewnet.tezosx.nomadic-labs.com',
  'POC_TEZOS_RPC=https://michelson.previewnet.tezosx.nomadic-labs.com',
  'POC_TZKT_API=https://api.previewnet.tezosx.tzkt.io',
  '',
];

writeFileSync(envPath, lines.join('\n'));
console.log(`wrote ${envPath}`);
console.log(`EVM address: ${wallet.address}`);
console.log(`\nFaucet this address at https://faucet.previewnet.tezosx.nomadic-labs.com (paste address, solve captcha).`);
