// Synthetic Java corpus only; never reads company source or GitLab credentials.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const count = Number(process.argv[2] || 32);
const methods = Number(process.argv[3] || 24);
if (!Number.isInteger(count) || count < 2 || count > 5000 || !Number.isInteger(methods) || methods < 1 || methods > 80) throw new Error('Invalid fixture size');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-java-perf-'));
const root = path.join(temp, 'source');
await fs.mkdir(root);
process.env.CODEGRAPH_CACHE_DIR = path.join(temp, 'cache');
const { createAgentSession } = await import('@lzehrung/codegraph/agent');
let bytes = 0;
for (let i = 0; i < count; i++) {
  const name = `Service${i}`;
  let source = `package fixture;\nimport java.util.Map;\nimport java.util.HashMap;\npublic class ${name} {\n  private final Map<String, Double> values = new HashMap<>();\n`;
  for (let m = 0; m < methods; m++) source += `  private double amount${m} = ${m}.0;\n  public double getAmount${m}() { return amount${m}; }\n  public void setAmount${m}(double value) { amount${m} = value; }\n  public double calculate${m}(double value) {\n    double previous = getAmount${m}();\n    double updated = Math.max(0.0, previous + value);\n    setAmount${m}(updated);\n    values.put("amount${m}", updated);\n    return values.getOrDefault("amount${m}", 0.0);\n  }\n`;
  source += `  public double callPeer(Service${(i + 1) % count} peer) { return peer.calculate0(amount0); }\n}\n`;
  bytes += Buffer.byteLength(source);
  await fs.writeFile(path.join(root, `${name}.java`), source);
}
const report = { timings: {} };
let lastLog = 0;
const session = createAgentSession({ root, freshness: { policy: 'manual' }, buildOptions: { report, onProgress(update) { if (performance.now() - lastLog > 5000 || update.type === 'complete') { console.log(JSON.stringify({ progress: update })); lastLog = performance.now(); } } } });
const start = performance.now();
const base = await session.loadProject({ symbolGraph: 'skip' });
const baseMs = performance.now() - start;
console.log(JSON.stringify({ phase: 'base', count, bytes, baseMs: Math.round(baseMs), timings: report.timings, workers: report.workerPool }));
const detailedStart = performance.now();
const full = await session.loadProject();
const result = { corpus: 'generated Java beans with calls', count, methods, bytes, baseMs: Math.round(baseMs), detailedMs: Math.round(performance.now() - detailedStart), totalMs: Math.round(performance.now() - start), indexedFiles: base.files.length, symbols: full.symbolGraph.nodes.size, edges: full.symbolGraph.edges.length, timings: report.timings, workers: report.workerPool, fixtureRoot: temp, platform: `${os.platform()}/${os.arch()}` };
console.log(JSON.stringify({ result }));
process.exit(0);
