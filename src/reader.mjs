import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAgentSession } from '@lzehrung/codegraph/agent';
import { serveCodegraphMcp } from '@lzehrung/codegraph/mcp';
import { exportViewer } from './viewer-export.mjs';

const root = path.resolve(process.argv[2]);
const started = performance.now();
let lastProgress = 0, lastPhase;
function emit(phase, values = {}, force = false) {
  const now = performance.now();
  if (!force && lastPhase === phase && now - lastProgress < 500) return;
  lastPhase = phase; lastProgress = now;
  // Only counters and measured timings cross the process boundary, never file names or source.
  process.stderr.write('@atlas-progress ' + JSON.stringify({ phase, elapsedMs: Math.round(now - started), ...values }) + '\n');
}
const report = { timings: {} };
const session = createAgentSession({ root, freshness: { policy: 'auto' }, buildOptions: { report, onProgress(update) {
  if (update.mode === 'check') emit('discovery', {}, update.phase === 'complete');
  else emit('indexing', { current: update.current, total: update.total }, update.phase === 'complete');
} } });
emit('discovery', {}, true);
const baseStart = performance.now();
const base = await session.loadProject({ symbolGraph: 'skip' });
const baseMs = performance.now() - baseStart;
emit('symbols', { timings: { baseMs, parseMs: report.timings.parseMs, graphMs: report.timings.graphMs, workerThreads: report.workerPool?.threads } }, true);
const symbolsStart = performance.now();
const full = await session.loadProject();
const symbolsMs = performance.now() - symbolsStart;
emit('viewer', {}, true);
await exportViewer(full, process.env.CODEGRAPH_CACHE_DIR, process.argv[3]);
emit('ready', { current: base.files.length, total: base.files.length, timings: { baseMs, parseMs: report.timings.parseMs, graphMs: report.timings.graphMs, symbolsMs, workerThreads: report.workerPool?.threads } }, true);
await serveCodegraphMcp({ root, session, warmup: 'off', idleTimeoutMs: 0 });
