/**
 * After V3 B2B Drive re-extract: fan-out multi-NC rows, refresh FF 15_10, rebuild V2 + V3 B2B tables.
 * CLI: node publish-after-v3-b2b-reextract.mjs
 * Render: GET/POST /publish-v3-b2b-after-reextract
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  'propagate-customers-ext-multi-nc.mjs',
  'build-upload-final-format-customers.mjs',
  'upload-v2-mews-import-19-10-2026.mjs',
  'upload-v3-b2b-mews-import-20-10-2026.mjs',
];

function runNodeScript(scriptName) {
  const scriptPath = path.join(here, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: here,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      process.stderr.write(s);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ script: scriptName, ok: true, tail: out.slice(-2000) });
      else reject(new Error(`${scriptName} exited ${code}: ${err.slice(-1500) || out.slice(-1500)}`));
    });
  });
}

export async function runPublishAfterV3B2bReextract() {
  const stepResults = [];
  for (const script of STEPS) {
    stepResults.push(await runNodeScript(script));
  }
  return { ok: true, steps: stepResults.map((s) => s.script) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runPublishAfterV3B2bReextract()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
