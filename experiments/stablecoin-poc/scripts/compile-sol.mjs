// Compile EvmToMichelsonCounter.sol to abi + bytecode and stash under
// experiments/stablecoin-poc/artifacts/.

import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const contractsDir = join(repo, 'contracts');
const outDir = join(repo, 'artifacts');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const sources = {};
for (const f of readdirSync(contractsDir)) {
  if (!f.endsWith('.sol')) continue;
  sources[f] = { content: readFileSync(join(contractsDir, f), 'utf8') };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter(e => e.severity === 'error');
  for (const e of output.errors) console.error(e.formattedMessage ?? e.message);
  if (fatal.length) process.exit(1);
}

for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm.bytecode.object) continue; // skip interfaces / abstract
    const out = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
    const dest = join(outDir, `${name}.json`);
    writeFileSync(dest, JSON.stringify(out, null, 2));
    console.log(`wrote ${dest} (${out.bytecode.length / 2 - 1} bytes bytecode)`);
  }
}
