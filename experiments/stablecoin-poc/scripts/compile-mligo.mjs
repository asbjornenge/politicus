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

const src = 'contracts/Counter.mligo';
const baseCmd = `docker run --rm ${userFlag} -v "${repo}":/cwd -w /cwd ${ligoImage} compile contract ${src} --skip-analytics`;

console.log(`Compiling ${src}`);
execSync(`${baseCmd} -o artifacts/Counter.tz`, { stdio: 'inherit' });
execSync(`${baseCmd} --michelson-format json -o artifacts/Counter.json`, { stdio: 'inherit' });
console.log(`wrote ${outDir}/Counter.{tz,json}`);
