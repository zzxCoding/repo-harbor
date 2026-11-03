import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startService } from '../src/server.mjs';
import { command } from '../src/sync.mjs';
import { gitlabFixture } from './fixture.mjs';

async function wait(fn) {
  const deadline = Date.now() + 60000;
  while (!fn()) { assert(Date.now() < deadline, '等待测试服务超时'); await new Promise(resolve => setTimeout(resolve, 50)); }
}
const parse = result => { assert(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };

test('bulk MCP reduces 24 lookups to two calls with scoped, pinned, bounded source evidence', { timeout: 120000 }, async t => {
  const fixture = await gitlabFixture({ multiProject: true });
  let service; const clients = [];
  t.after(async () => { await Promise.allSettled(clients.map(client => client.close())); await service?.close(); await fixture.close(); });
  // 各文件使用唯一关键词，避免把少读文件误判为批量优化。
  for (let i = 0; i < 12; i++) await fs.writeFile(path.join(fixture.source, `src/Payment${i}.java`), `package example;\npublic class Payment${i} {\n  public int settlePayment${i}(int value) { return value; }\n}\n`);
  await fs.writeFile(path.join(fixture.source, '.env'), 'API_KEY=SENSITIVE_FIXTURE_VALUE\n');
  await fs.writeFile(path.join(fixture.source, 'src/large.ts'), Array.from({ length: 400 }, (_, i) => `// ${i}: ${'大'.repeat(100)}`).join('\n'));
  await command('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'add', '.'], { cwd: fixture.source });
  await command('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'bulk-fixture'], { cwd: fixture.source });
  await command('git', ['push', 'origin', 'main'], { cwd: fixture.source });
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'fixture-admin-password';
  service = await startService({ dataDir: path.join(fixture.root, 'data'), host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${service.port}`; let cookie = '';
  async function api(route, method = 'GET', body) {
    const response = await fetch(`${base}/api/${route}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    assert(response.ok, `API status ${response.status}`); return response.json();
  }
  await api('login', 'POST', { password: 'fixture-admin-password' });
  await api('connection', 'PUT', { baseUrl: fixture.baseUrl, token: fixture.token, username: 'oauth2' });
  const [id, privateId] = (await api('repositories', 'POST', { projectIds: [7, 8] })).added;
  await wait(() => service.store.state.repositories.every(repo => ['ready', 'error'].includes(repo.status)));
  for (const repo of service.store.state.repositories) assert.equal(repo.status, 'ready', repo.lastError);
  const repo = () => service.store.state.repositories.find(r => r.id === id);
  const grant = await api('access-tokens', 'POST', { name: 'Bulk reader', repositoryIds: [id] });
  const secret = (await api(`access-tokens/${grant.token.id}/secret`)).token;
  async function connect() {
    const client = new Client({ name: 'bulk-fixture', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
    clients.push(client); return client;
  }
  const client = await connect();
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['find_files', 'grep', 'get_files']) assert(tools.includes(name), `缺少批量工具 ${name}`);
  const patterns = Array.from({ length: 12 }, (_,i) => `settlePayment${i}(`);
  const before = { ...fixture.counters };
  const search = parse(await client.callTool({ name: 'grep', arguments: { repo: id, patterns, include: ['src/*.java'], context: 0 } }));
  assert.equal(search.results.length, 12); assert.equal(search.truncated, false);
  assert(search.results.every(result => result.line === 3 && result.isMatch));
  const files = search.results.map(result => ({ file: result.file, offset: 1, limit: 10 }));
  const read = parse(await client.callTool({ name: 'get_files', arguments: { repo: id, files } }));
  assert.equal(read.results.length, 12); assert.equal(read.truncated, false);
  assert(read.results.every(result => result.content.includes('package example;')));
  assert.equal(new Set(read.results.map(result => result.file)).size, 12);
  assert.equal(search.repository.commit, read.repository.commit);
  assert.deepEqual(fixture.counters, before, '检索阶段不得访问托管平台');
  assert.equal(parse(await client.callTool({ name: 'find_files', arguments: { repo: id, include: ['src/*.java'] } })).results.length, 12);
  const mixed = parse(await client.callTool({ name: 'get_files', arguments: { repo: id, files: [{ file: 'src/pricing.ts' }, { file: '../../state.json' }, { file: 'state-link.json' }, { file: 'missing.ts' }] } }));
  assert(mixed.results[0].content.includes('fixture-v1')); assert(mixed.results.slice(1).every(result => result.isError));
  const redacted = parse(await client.callTool({ name: 'get_files', arguments: { repo: id, files: [{ file: '.env' }] } }));
  assert.equal(redacted.results[0].sensitive.redacted, true); assert(!JSON.stringify(redacted).includes('SENSITIVE_FIXTURE_VALUE'));
  const limited = parse(await client.callTool({ name: 'get_files', arguments: { repo: id, maxBytes: 4096, files: Array.from({ length: 5 }, () => ({ file: 'src/large.ts' })) } }));
  assert(Buffer.byteLength(JSON.stringify(limited.results)) <= 4098);
  assert(limited.truncated); assert(limited.nextIndex > 0 && limited.nextIndex < 5);
  assert(limited.results.every(item => item.truncated && item.nextOffset >= 1));
  for (const name of ['find_files', 'grep', 'get_files']) {
    const denied = await client.callTool({ name, arguments: { repo: privateId, patterns: ['PRIVATE_REPO_ONLY_CONTENT'], files: [{ file: 'src/private-only.ts' }] } });
    assert.equal(denied.isError, true); assert.equal(denied.content[0].text, '仓库不可用或未授权');
  }
  const oldCommit = search.repository.commit;
  await wait(() => service.sync.runningId !== id);
  const newCommit = await fixture.update(2); await api('sync', 'POST', { id });
  await wait(() => repo().current.commit === newCommit || repo().status === 'error'); assert.equal(repo().status, 'ready', repo().lastError);
  const old = parse(await client.callTool({ name: 'grep', arguments: { repo: id, patterns: ['fixture-v1'], include: ['src/pricing.ts'], context: 0 } }));
  assert.equal(old.repository.commit, oldCommit); assert.equal(old.results.length, 1);
  const fresh = await connect();
  assert.equal(parse(await fresh.callTool({ name: 'get_files', arguments: { repo: id, files: [{ file: 'src/pricing.ts' }] } })).repository.commit, newCommit);
  // 在批量读取期间撤权，整个结果应被丢弃，不能返回已经读到的文件。
  const engine = await service.pool.ensure(repo().current), original = engine.call.bind(engine);
  let enter, release; const entered = new Promise(resolve => enter = resolve), gate = new Promise(resolve => release = resolve);
  t.after(() => release?.());
  engine.call = async (name, args) => { if (name === 'get_file') { enter(); await gate; } return original(name, args); };
  const pending = fresh.callTool({ name: 'get_files', arguments: { repo: id, files: [{ file: 'src/pricing.ts' }] } }, undefined, { timeout: 5000 }).catch(() => ({ closed: true }));
  await entered;
  const revoke = api(`access-tokens/${grant.token.id}`, 'PATCH', { repositoryIds: [] });
  await wait(() => service.store.state.accessTokens.find(token => token.id === grant.token.id).repositoryIds.length === 0);
  release(); await revoke;
  const denied = await pending; assert(denied.closed || denied.isError); assert(!JSON.stringify(denied).includes('fixture-v2'));
  await wait(() => service.mcp.inFlight === 0);
  console.log(JSON.stringify({ proof: '24 lookups -> 2 MCP calls, same 12 files, scoped access, pinned commit, in-flight revocation', sourceBytes: Buffer.byteLength(JSON.stringify(search) + JSON.stringify(read)) }));
});
