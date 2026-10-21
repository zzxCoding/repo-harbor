import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startService } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { sourceInput, testSource, resolveRepository } from '../src/sources.mjs';
import { gitlabFixture } from './fixture.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const unpack = result => JSON.parse(result.content.find(c => c.type === 'text').text);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('GitLab, GitHub and generic Git share native maps with isolated credentials, migrated snapshots and unambiguous MCP scopes', { timeout: 120000 }, async t => {
  const fixtures = [];
  for (const provider of ['gitlab', 'github', 'git']) fixtures.push(await gitlabFixture({ provider }));
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'fixture-admin-password';
  const dataDir = path.join(fixtures[0].root, 'service-data'); let service = await startService({ host: '127.0.0.1', port: 0, dataDir });
  let base = `http://127.0.0.1:${service.port}`, cookie; const clients = [];
  t.after(async () => { await Promise.allSettled(clients.map(c => c.close())); await service.close(); await Promise.all(fixtures.map(f => f.close())); });
  async function api(route, method = 'GET', body) {
    const res = await fetch(`${base}/api/${route}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (route === 'login' && res.ok) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  }
  async function ok(route, method, body) { const result = await api(route, method, body); assert.ok(result.status < 300, JSON.stringify(result)); return result.body; }
  async function waitFor(id) { for (let i = 0; i < 200; i++) { const r = service.store.state.repositories.find(r => r.id === id); if (r?.status === 'error') throw new Error(r.lastError); if (r?.status === 'ready') return r; await pause(100); } throw new Error('map did not publish'); }
  async function client(secret) { const c = new Client({ name: 'multi-source-fixture', version: '1' }); await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } })); clients.push(c); return c; }
  await ok('login', 'POST', { password: 'fixture-admin-password' });
  const first = fixtures[0];
  let connection = (await ok('connections', 'POST', { type: 'gitlab', name: 'Internal GitLab', baseUrl: first.baseUrl, token: first.token })).connection;
  const originalId = (await ok('repositories', 'POST', { connectionId: connection.id, projectPath: 'team/service' })).added[0];
  const original = await waitFor(originalId), originalCommit = original.current.commit;
  const token = (await ok('access-tokens', 'POST', { name: 'existing reader', repositoryIds: [originalId] })).token;
  const secret = (await ok(`access-tokens/${token.id}/secret`)).token;
  const auth = structuredClone(service.store.state.auth);
  // Recreate the exact single-connection v2 persistence shape of 0.1.3, with a real published native map.
  await service.close();
  const stateFile = path.join(dataDir, 'state.json'), old = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  old.version = 2; old.connection = old.connections[0]; delete old.connections;
  for (const r of old.repositories) { delete r.connectionId; delete r.externalId; }
  await fs.writeFile(stateFile, JSON.stringify(old));
  service = await startService({ host: '127.0.0.1', port: 0, dataDir }); base = `http://127.0.0.1:${service.port}`;
  await ok('login', 'POST', { password: 'fixture-admin-password' }); await waitFor(originalId);
  assert.equal(service.store.state.version, 3); assert.deepEqual(service.store.state.auth, auth);
  assert.equal(service.store.state.repositories[0].current.commit, originalCommit);
  assert.equal((await ok(`access-tokens/${token.id}/secret`)).token, secret);
  connection = (await ok('state')).connections[0];
  const sourceIds = [connection.id], repositoryIds = [originalId];
  for (const fixture of fixtures.slice(1)) {
    const c = (await ok('connections', 'POST', { type: fixture.provider, name: fixture.provider, baseUrl: fixture.baseUrl, username: fixture.username, token: fixture.token })).connection;
    sourceIds.push(c.id);
    const added = await ok('repositories', 'POST', { connectionId: c.id, projectPath: fixture.provider === 'git' ? `${fixture.baseUrl}/team/service.git` : 'team/service' });
    const id = added.added[0]; repositoryIds.push(id); await waitFor(id);
    const branches = await ok(`branches?repoId=${id}`); assert.deepEqual(branches.branches.map(b => b.name).sort(), ['main', 'release']);
  }
  assert.equal(service.store.state.repositories.length, 3); // GitLab and GitHub intentionally share numeric project id 7.
  assert.equal((await api('repositories', 'POST', { projectPath: 'team/service' })).status, 400);
  assert.equal((await api(`connections/${sourceIds[0]}`, 'DELETE', {})).status, 400);
  assert.equal((await api(`connections/${sourceIds[0]}`, 'PATCH', { baseUrl: fixtures[1].baseUrl, token: fixtures[1].token })).status, 400);
  assert.equal((await api('repositories', 'POST', { connectionId: sourceIds[0], projectPath: `${fixtures[1].baseUrl}/team/service.git` })).status, 400);
  assert.equal((await api('repositories', 'POST', { connectionId: sourceIds[2], projectPath: `http://user:password@${new URL(fixtures[2].baseUrl).host}/team/service.git` })).status, 400);
  const scoped = await client(secret); assert.deepEqual(unpack(await scoped.callTool({ name: 'list_repos', arguments: {} })).repositories.map(r => r.id), [originalId]);
  assert.equal((await scoped.callTool({ name: 'get_file', arguments: { repo: repositoryIds[1], file: 'src/source.ts' } })).isError, true);
  const all = (await ok('access-tokens', 'POST', { name: 'all selected', repositoryIds })).token;
  const reader = await client((await ok(`access-tokens/${all.id}/secret`)).token);
  const list = unpack(await reader.callTool({ name: 'list_repos', arguments: {} })).repositories;
  assert.equal(list.length, 3); assert.deepEqual(list.map(r => r.source.type), ['gitlab', 'github', 'git']);
  const ambiguous = await reader.callTool({ name: 'get_file', arguments: { repo: 'team/service', file: 'src/source.ts' } });
  assert.equal(ambiguous.isError, true); assert.match(ambiguous.content[0].text, /多个代码源/);
  for (const [i, repo] of list.entries()) {
    const result = unpack(await reader.callTool({ name: 'get_file', arguments: { repo: repo.id, file: 'src/source.ts' } }));
    assert.ok(JSON.stringify(result).includes(`sourceProvider = \\"${fixtures[i].provider}\\"`));
    assert.equal(result.repository.source.id, sourceIds[i]);
    const search = await reader.callTool({ name: 'search', arguments: { repo: repo.id, query: 'calculatePrice' } }); assert.notEqual(search.isError, true);
  }
  assert.equal(fixtures[2].counters.api, 0, 'generic Git must work without a hosting API');
  for (const fixture of fixtures) {
    assert.equal(fixture.counters.wrongCredentials, 0, 'no credentials may cross connections');
    assert(!JSON.stringify(service.store.publicState()).includes(fixture.token));
    assert(!(await fs.readFile(stateFile, 'utf8')).includes(fixture.token));
    for (const engine of service.pool.engines.values()) assert(!JSON.stringify(engine.transport._serverParams.env).includes(fixture.token));
  }
  await Promise.all(clients.map(c => c.close())); clients.length = 0; await service.close();
  service = await startService({ host: '127.0.0.1', port: 0, dataDir }); base = `http://127.0.0.1:${service.port}`;
  await ok('login', 'POST', { password: 'fixture-admin-password' });
  assert.equal((await ok('state')).connections.length, 3);
  for (const id of repositoryIds) await waitFor(id);
  const restarted = await client(secret); assert.deepEqual(unpack(await restarted.callTool({ name: 'list_repos', arguments: {} })).repositories.map(r => r.id), [originalId]);
});

test('public GitHub and generic Git accept anonymous reads; invalid source bindings fail closed', { timeout: 30000 }, async t => {
  const fixture = await gitlabFixture({ provider: 'github', anonymous: true }); t.after(() => fixture.close());
  const github = sourceInput({ type: 'github', name: 'public', baseUrl: fixture.baseUrl, anonymous: true });
  assert.equal((await testSource(github)).verified, true);
  assert.equal((await resolveRepository(github, 'team/service')).defaultBranch, 'main');
  const generic = sourceInput({ type: 'git', name: 'public git', baseUrl: fixture.baseUrl, anonymous: true });
  assert.equal((await testSource(generic)).verified, false);
  assert.equal((await resolveRepository(generic, `${fixture.baseUrl}/team/service.git`)).defaultBranch, 'main');
  assert.throws(() => sourceInput({ type: 'gitlab', baseUrl: fixture.baseUrl, anonymous: true }));
  assert.throws(() => sourceInput({ type: 'github', baseUrl: fixture.baseUrl, token: 'bad\r\nheader' }));
  const store = await new Store(path.join(fixture.root, 'invalid-state')).open();
  store.state.repositories.push({ id: 'orphan', connectionId: 'missing', externalId: '7', enabled: true }); await store.save();
  const before = await fs.readFile(store.file, 'utf8'); await assert.rejects(new Store(store.dir).open(), /所属代码源配置损坏/);
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
});
