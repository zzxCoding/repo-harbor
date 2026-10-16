import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'public', 'scripts', 'test']) for (const name of await fs.readdir(dir)) if (/\.(mjs|js)$/.test(name)) {
  const r = spawnSync(process.execPath, ['--check', path.join(dir, name)], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1);
}
console.log('JavaScript syntax checks passed');
