import { execSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = join(repoRoot, 'contracts');
const artifactsDir = join(repoRoot, 'artifacts');

if (!existsSync(artifactsDir)) mkdirSync(artifactsDir);

const ligoImage = process.env.LIGO_IMAGE ?? 'ligolang/ligo:1.7.0';

const requested = process.argv.slice(2);
const sources = (requested.length > 0 ? requested : readdirSync(contractsDir))
  .filter(f => f.endsWith('.mligo'));

if (sources.length === 0) {
  console.error('No .mligo sources found in contracts/');
  process.exit(1);
}

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const userFlag = uid ? `--user ${uid}:${gid}` : '';

for (const src of sources) {
  const name = basename(src, '.mligo');
  console.log(`Compiling ${src}`);

  const baseCmd = `docker run --rm ${userFlag} -v "${repoRoot}":/cwd -w /cwd ${ligoImage} compile contract contracts/${src} --skip-analytics`;

  execSync(`${baseCmd} -o artifacts/${name}.tz`, { stdio: 'inherit' });
  execSync(`${baseCmd} --michelson-format json -o artifacts/${name}.json`, { stdio: 'inherit' });
}

console.log(`Done. Artifacts in artifacts/`);
