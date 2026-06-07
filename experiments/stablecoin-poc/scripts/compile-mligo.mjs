// Compile Counter.mligo via the LIGO container the main project uses.
// Writes Counter.json (Micheline JSON) under artifacts/.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const repoRoot = join(repo, '..', '..');
const outDir = join(repo, 'artifacts');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const ligoImage = process.env.LIGO_IMAGE ?? 'ligolang/ligo:1.7.0';
const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const userFlag = uid ? `--user ${uid}:${gid}` : '';

import { readdirSync } from 'node:fs';
const contractsDir = join(repo, 'contracts');
const sources = readdirSync(contractsDir).filter(f => f.endsWith('.mligo'));
for (const f of sources) {
  const name = f.replace(/\.mligo$/, '');
  const src = `contracts/${f}`;
  const baseCmd = `docker run --rm ${userFlag} -v "${repo}":/cwd -w /cwd ${ligoImage} compile contract ${src} --skip-analytics`;
  console.log(`Compiling ${src}`);
  execSync(`${baseCmd} -o artifacts/${name}.tz`, { stdio: 'inherit' });
  execSync(`${baseCmd} --michelson-format json -o artifacts/${name}.json`, { stdio: 'inherit' });
}
console.log(`wrote artifacts/`);
