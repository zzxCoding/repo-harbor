import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { decodeProgress, buildTimeoutMinutes } from '../src/build-progress.mjs';
const { Engine } = await import(process.env.ATLAS_ENGINE_UNDER_TEST ? pathToFileURL(process.env.ATLAS_ENGINE_UNDER_TEST).href : '../src/engine.mjs');

async function snapshot() {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-startup-test-'));
  const root = path.join(data, 'source'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'Example.java'), 'package fixture; public class Example { public int normalize(int value) { return Math.max(0, value); } public int calculate(int value) { return normalize(value) * 2; } }\n');
  return { data, snapshot: { repoId: 'fixture', commit: 'a'.repeat(40), root, cache: path.join(data, 'cache') } };
}
test('cold reader honors a configured startup cap and terminates on timeout', { timeout: 15000 }, async t => {
  const fixture = await snapshot();
  const engine = new Engine(fixture.snapshot, fixture.data, { startupTimeoutMs: 1 });
  t.after(() => engine.close());
  await assert.rejects(engine.start(), /建图超时/);
  assert.equal(engine.closed, true);
});
test('slow cold initialization publishes real native map progress within its configured budget', { timeout: 15000 }, async t => {
  const fixture = await snapshot();
  const wrapper = path.join(fixture.data, 'slow-reader.mjs');
  await fs.writeFile(wrapper, `await new Promise(resolve => setTimeout(resolve, 300)); await import(${JSON.stringify(new URL('../src/reader.mjs', import.meta.url).href)});\n`);
  const updates = []; const started = Date.now();
  const engine = new Engine(fixture.snapshot, fixture.data, { startupTimeoutMs: 10000, readerPath: wrapper, onProgress: progress => updates.push(progress) });
  t.after(() => engine.close());
  await engine.start();
  assert(Date.now() - started >= 300, 'must exercise a delayed pre-initialize build');
  assert(updates.some(p => p.phase === 'symbols'));
  assert(updates.some(p => p.phase === 'ready' && p.current === 1 && p.total === 1));
  const file = await engine.call('get_file', { file: 'Example.java', limit: 10 });
  assert.equal(file.isError, undefined);
  assert(JSON.stringify(file).includes('calculate'));
});
test('service shutdown aborts a reader that is still warming instead of waiting for its long cap', { timeout: 15000 }, async t => {
  const fixture = await snapshot(); const controller = new AbortController();
  const wrapper = path.join(fixture.data, 'delayed-reader.mjs');
  await fs.writeFile(wrapper, `await new Promise(resolve => setTimeout(resolve, 6000)); await import(${JSON.stringify(new URL('../src/reader.mjs', import.meta.url).href)});\n`);
  const engine = new Engine(fixture.snapshot, fixture.data, { startupTimeoutMs: 10000, readerPath: wrapper, signal: controller.signal });
  t.after(() => engine.close());
  const started = Date.now(); const promise = engine.start();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(promise);
  assert(Date.now() - started < 3500, 'shutdown must stop within the stdio transport termination grace, before warmup completes');
});
test('progress channel excludes source and credentials; invalid progress and budgets are rejected', () => {
  const value = decodeProgress('@atlas-progress ' + JSON.stringify({ phase: 'indexing', current: 1606, total: 4062, elapsedMs: 880200, token: 'secret', message: 'private file', timings: { parseMs: 22, privateSource: 'secret' } }));
  assert.deepEqual(value, { phase: 'indexing', current: 1606, total: 4062, elapsedMs: 880200, timings: { parseMs: 22 } });
  assert.equal(decodeProgress('@atlas-progress {"phase":"indexing","current":8,"total":2}'), null);
  assert.equal(decodeProgress('@atlas-progress {}'), null);
  assert.equal(buildTimeoutMinutes(), 120);
  assert.throws(() => buildTimeoutMinutes(4)); assert.throws(() => buildTimeoutMinutes(361));
});
