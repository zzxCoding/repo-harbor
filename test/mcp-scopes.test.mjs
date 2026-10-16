import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startService } from '../src/server.mjs';
import { engineTools } from '../src/engine.mjs';
import { gitlabFixture } from './fixture.mjs';
const parse = result => JSON.parse(result.content[0].text);
async function wait(fn) { const start = Date.now(); while (!fn()) { if (Date.now() - start > 60000) throw new Error('Scope fixture timed out'); await new Promise(r => setTimeout(r,100)); } }
test('scoped tokens isolate all MCP tools, bind sessions, revoke in-flight results, persist permissions and exclude re-created repositories', { timeout: 180000 }, async t => {
  const fixture = await gitlabFixture({ multiProject: true }); process.env.ADMIN_BOOTSTRAP_PASSWORD = 'fixture-admin-password';
  const dataDir = path.join(fixture.root, 'data'); let service = await startService({ dataDir, host: '127.0.0.1', port: 0 }), base = `http://127.0.0.1:${service.port}`, cookie = '', release;
  const clients = []; t.after(async () => { release?.(); await Promise.allSettled(clients.map(c => c.close())); await service.close(); await fixture.close(); });
  async function api(route, method = 'GET', body) {
    const response = await fetch(`${base}/api/${route}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]; return { status: response.status, body: await response.json() };
  }
  async function connect(secret) { const client = new Client({ name: 'scoped-fixture', version: '1' }); const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }); await client.connect(transport); clients.push(client); return { client, transport }; }
  const deny = result => { assert.equal(result.isError, true); assert.equal(result.content[0].text, '仓库不可用或未授权'); };
  assert.equal((await api('access-tokens')).status, 401);
  await api('login', 'POST', { password: 'fixture-admin-password' }); await api('connection', 'PUT', { baseUrl: fixture.baseUrl, token: fixture.token, username: 'oauth2' });
  const added = (await api('repositories', 'POST', { projectIds: [7, 8] })).body.added; assert.equal(added.length, 2);
  const a = added[0], b = added[1]; await wait(() => service.store.state.repositories.every(r => r.status === 'ready' || r.status === 'error'));
  for (const r of service.store.state.repositories) assert.equal(r.status, 'ready', r.lastError);
  async function token(name, repositoryIds) { const created = await api('access-tokens', 'POST', { name, repositoryIds }); assert.equal(created.status, 201); const id = created.body.token.id; const secret = (await api(`access-tokens/${id}/secret`)).body.token; return { id, secret }; }
  const ta = await token('A client', [a]), tb = await token('B client', [b]), tc = await token('Both client', [a, b]);
  let ca = (await connect(ta.secret)).client; const cb = (await connect(tb.secret)).client; const both = (await connect(tc.secret)).client;
  assert.deepEqual(parse(await ca.callTool({ name: 'list_repos', arguments: {} })).repositories.map(r => r.id), [a]);
  assert.deepEqual(parse(await cb.callTool({ name: 'list_repos', arguments: {} })).repositories.map(r => r.id), [b]);
  assert.equal(parse(await both.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 2);
  assert.equal((await both.callTool({ name: 'get_file', arguments: { file: 'src/pricing.ts' } })).isError, true);
  for (const tool of engineTools) deny(await ca.callTool({ name: tool.name, arguments: { repo: b } }));
  deny(await ca.callTool({ name: 'search', arguments: { repo: 'team/private', query: 'privateValue' } }));
  deny(await ca.callTool({ name: 'get_file', arguments: { repo: 'nonexistent', file: 'src/private-only.ts' } }));
  assert(parse(await ca.callTool({ name: 'get_file', arguments: { file: 'src/pricing.ts' } })).text.includes('fixture-v1'));
  assert(parse(await cb.callTool({ name: 'get_file', arguments: { repo: b, file: 'src/private-only.ts' } })).text.includes('PRIVATE_REPO_ONLY_CONTENT'));
  const privateSearch = parse(await cb.callTool({ name: 'search', arguments: { repo: b, query: 'privateValue', mode: 'symbol' } })); const privateHandle = privateSearch.results[0].handle;
  for (const name of ['get_symbol', 'goto', 'refs']) {
    const result = await ca.callTool({ name, arguments: { repo: a, handle: privateHandle } });
    assert(!JSON.stringify(result).includes('PRIVATE_REPO_ONLY_CONTENT'));
    if (!result.isError) { const value = parse(result); assert.equal(value.repository.id, a); if (name === 'get_symbol') assert.equal(value.kind, 'not_found'); if (name === 'refs') assert.deepEqual(value.references, []); }
  }
  const privateSnapshot = service.store.state.repositories.find(r => r.id === b).current;
  assert.equal((await ca.callTool({ name: 'get_file', arguments: { repo: a, file: path.join(privateSnapshot.root, 'src/private-only.ts'), allowSensitive: true } })).isError, true);
  assert.equal((await fetch(`${base}/api/access-tokens`, { headers: { Authorization: `Bearer ${ta.secret}` } })).status, 401);
  const owned = await connect(ta.secret);
  const stolen = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tb.secret}`, 'Mcp-Session-Id': owned.transport.sessionId, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'list_repos', arguments: {} } }) }); assert.equal(stolen.status, 404);
  await api(`access-tokens/${ta.id}`, 'PATCH', { repositoryIds: [b] }); assert.equal(service.mcp.sessions.has(owned.transport.sessionId), false);
  ca = (await connect(ta.secret)).client; assert.deepEqual(parse(await ca.callTool({ name: 'list_repos', arguments: {} })).repositories.map(r => r.id), [b]); deny(await ca.callTool({ name: 'get_file', arguments: { repo: a, file: 'src/pricing.ts' } }));
  assert.equal(parse(await cb.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 1, 'other token session survives scope edit');
  await api(`access-tokens/${ta.id}`, 'PATCH', { repositoryIds: [a] }); ca = (await connect(ta.secret)).client;
  const engine = await service.pool.ensure(service.store.state.repositories.find(r => r.id === a).current), original = engine.call.bind(engine);
  let enter; const entered = new Promise(r => enter = r), gate = new Promise(r => release = r);
  engine.call = async (name, args) => { if (name === 'get_file') { enter(); await gate; } return original(name, args); };
  const inFlight = ca.callTool({ name: 'get_file', arguments: { repo: a, file: 'src/pricing.ts' } }).then(result => result, () => ({ transportClosed: true })); await entered;
  const change = api(`access-tokens/${ta.id}`, 'PATCH', { repositoryIds: [] }); await wait(() => service.store.state.accessTokens.find(t => t.id === ta.id).repositoryIds.length === 0); release();
  await change; const withheld = await inFlight; assert(withheld.transportClosed || withheld.isError); assert(!JSON.stringify(withheld).includes('fixture-v1')); await wait(() => service.mcp.inFlight === 0); engine.call = original;
  ca = (await connect(ta.secret)).client; assert.equal(parse(await ca.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 0);
  await api(`access-tokens/${ta.id}`, 'PATCH', { repositoryIds: [a] }); await api(`access-tokens/${ta.id}/rotate`, 'POST', {}); const rotated = (await api(`access-tokens/${ta.id}/secret`)).body.token; assert.notEqual(rotated, ta.secret);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${ta.secret}` } })).status, 401);
  assert(parse(await cb.callTool({ name: 'get_file', arguments: { repo: b, file: 'src/private-only.ts' } })).text.includes('PRIVATE_REPO_ONLY_CONTENT'));
  await api(`access-tokens/${tc.id}`, 'DELETE', {}); assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tc.secret}` } })).status, 401);
  await api(`access-tokens/${tb.id}`, 'PATCH', { enabled: false }); assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tb.secret}` } })).status, 401);
  await api(`access-tokens/${tb.id}`, 'PATCH', { enabled: true });
  ca = (await connect(rotated)).client; await api(`repositories/${a}`, 'PATCH', { enabled: false }); assert.equal(parse(await ca.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 0); deny(await ca.callTool({ name: 'get_file', arguments: { repo: a, file: 'src/pricing.ts' } }));
  await api(`repositories/${a}`, 'PATCH', { enabled: true });
  await api(`repositories/${b}`, 'DELETE', {}); const newB = (await api('repositories', 'POST', { projectPath: 'team/private' })).body.added[0]; assert.notEqual(newB, b);
  const noNewAccess = (await connect(tb.secret)).client; assert.equal(parse(await noNewAccess.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 0); deny(await noNewAccess.callTool({ name: 'get_file', arguments: { repo: 'team/private', file: 'src/private-only.ts' } }));
  await wait(() => service.store.state.repositories.every(r => r.status === 'ready'));
  const stateText = await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'); for (const secret of [ta.secret, tb.secret, tc.secret, rotated]) assert(!stateText.includes(secret));
  await Promise.allSettled(clients.map(c => c.close())); await service.close();
  service = await startService({ dataDir, host: '127.0.0.1', port: 0 }); base = `http://127.0.0.1:${service.port}`; cookie = ''; await api('login', 'POST', { password: 'fixture-admin-password' });
  assert.equal((await api(`access-tokens/${ta.id}/secret`)).body.token, rotated); assert.equal((await api('access-tokens')).body.tokens.length, 2);
  ca = (await connect(rotated)).client; assert.equal(parse(await ca.callTool({ name: 'get_file', arguments: { repo: a, file: 'src/pricing.ts' } })).repository.id, a);
  const restartedB = (await connect(tb.secret)).client; assert.equal(parse(await restartedB.callTool({ name: 'list_repos', arguments: {} })).repositories.length, 0);
  console.log(JSON.stringify({ proof: 'native two-repository token isolation, all 18 map/source tools, owner-bound sessions, in-flight revocation, scoped rotation, empty grants, disabled tokens, repository recreation, encryption and restart', repositories: 2 }));
});
