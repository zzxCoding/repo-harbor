import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../src/store.mjs';
import { AccessTokens } from '../src/access-tokens.mjs';
import { randomToken } from '../src/security.mjs';
const fixtureSource = crypto.randomUUID();
async function store() { process.env.ADMIN_BOOTSTRAP_PASSWORD = 'fixture-admin-password'; const s = await new Store(await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-token-store-'))).open(); s.state.connections.push({ id: fixtureSource, type: 'gitlab', name: 'fixture', baseUrl: 'https://gitlab.example.invalid', username: 'oauth2', token: s.seal('fixture-token'), anonymous: false, revision: 1 }); return s; }
const repo = name => ({ id: crypto.randomUUID(), path: `team/${name}`, connectionId: fixtureSource, externalId: name, enabled: true });

test('legacy global token migrates once into an explicit scope; new repositories are never automatically granted', async () => {
  const saved = await store(), a = repo('a'), b = { ...repo('b'), enabled: false }, future = repo('future');
  const secret = randomToken(); saved.state = { ...saved.state, version: 1, mcpToken: saved.seal(secret), connection: saved.state.connections[0], repositories: [a, b] }; delete saved.state.accessTokens; delete saved.state.connections; await saved.save();
  const migrated = await new Store(saved.dir).open(), tokens = new AccessTokens(migrated), legacy = tokens.legacy();
  assert.equal(migrated.state.version, 3); assert.equal(migrated.unseal(legacy.secret), secret); assert.deepEqual(legacy.repositoryIds, [a.id, b.id]);
  assert(!('mcpToken' in migrated.state)); assert(!JSON.stringify(tokens.list()).includes(secret));
  future.connectionId = migrated.state.connections[0].id; migrated.state.repositories.push(future); await migrated.save();
  assert.deepEqual(tokens.available(legacy.id, legacy.revision).map(r => r.id), [a.id]);
  const reopened = await new Store(saved.dir).open(); assert.equal(reopened.state.accessTokens.length, 1); assert.equal(reopened.state.accessTokens[0].id, legacy.id); assert.equal(reopened.unseal(reopened.state.accessTokens[0].secret), secret);
  assert(!JSON.stringify(reopened.state).includes(secret));
});

test('new install has no global credential; token input only grants existing ids and public metadata excludes secrets', async () => {
  const saved = await store(), a = repo('a'); saved.state.repositories.push(a); const tokens = new AccessTokens(saved);
  assert.equal(tokens.list().length, 0); assert.throws(() => tokens.legacy(), /创建读取令牌/);
  for (const repositoryIds of [[], ['*'], [crypto.randomUUID()], [null], 'all']) await assert.rejects(tokens.create({ name: 'reader', repositoryIds }));
  await assert.rejects(tokens.create({ name: ' ', repositoryIds: [a.id] }));
  const item = await tokens.create({ name: ' reader ', repositoryIds: [a.id, a.id] }); assert.equal(item.name, 'reader'); assert.deepEqual(item.repositoryIds, [a.id]); assert.equal(item.secret, undefined);
  const secret = saved.unseal(tokens.get(item.id).secret); assert(tokens.authenticate({ headers: { authorization: `Bearer ${secret}` } }));
  assert.equal(tokens.authenticate({ headers: { authorization: `Bearer ${secret} extra` } }), null);
  assert(!JSON.stringify(saved.publicState()).includes(secret)); assert(!JSON.stringify(saved.publicState()).includes('"secret"'));
  await tokens.update(item.id, { repositoryIds: [] }); assert.equal(tokens.available(item.id, tokens.get(item.id).revision).length, 0);
  await tokens.update(item.id, { enabled: false }); assert.equal(tokens.authenticate({ headers: { authorization: `Bearer ${secret}` } }), null);
});

test('missing or corrupted persisted scope fails closed rather than becoming all repositories', async () => {
  const saved = await store(), a = repo('a'); saved.state.repositories.push(a); const tokens = new AccessTokens(saved); const item = await tokens.create({ name: 'reader', repositoryIds: [a.id] });
  delete tokens.get(item.id).repositoryIds; await saved.save(); await assert.rejects(new Store(saved.dir).open(), /令牌配置损坏/);
});
