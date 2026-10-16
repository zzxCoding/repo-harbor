import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const mode = process.argv[3] || 'current';
const moduleUrl = mode === 'legacy' ? new URL('../.test-data/old-engine.mjs', import.meta.url) : new URL('../src/engine.mjs', import.meta.url);
const { Engine } = await import(moduleUrl.href);
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-reader-bench-'));
const engine = new Engine({ repoId: 'synthetic-java', commit: 'b'.repeat(40), root, cache: path.join(data, 'cache') }, data);
const started = Date.now();
try {
  await engine.start();
  console.log(JSON.stringify({ result: { mode, startupMs: Date.now() - started, platform: `${os.platform()}/${os.arch()}`, availableParallelism: os.availableParallelism(), progress: engine.progress || null, lastLegacyProgress: engine.logs.split('\n').filter(line => line.includes('[Progress]')).slice(-4) } }));
} finally { await engine.close(); }
