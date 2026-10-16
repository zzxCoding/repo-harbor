import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encrypt, decrypt, normalizedBaseUrl, sameGitlabRepository } from '../src/security.mjs';
import { Store } from '../src/store.mjs';

test('credentials authenticated encryption, wrong key and tampering rejected', () => {
  const key = crypto.randomBytes(32); const value = encrypt('private-token', key);
  assert.equal(decrypt(value, key), 'private-token'); assert(!JSON.stringify(value).includes('private-token'));
  assert.throws(() => decrypt(value, crypto.randomBytes(32)));
  assert.throws(() => decrypt({ ...value, bytes: Buffer.from('tampered').toString('base64') }, key));
});
test('repository credentials cannot be sent to another origin or URL userinfo', () => {
  assert.equal(normalizedBaseUrl('https://gitlab.internal/sub/'), 'https://gitlab.internal/sub');
  assert.throws(() => normalizedBaseUrl('https://user:token@gitlab.internal'));
  assert.throws(() => sameGitlabRepository('https://attacker.invalid/team/repo.git', 'https://gitlab.internal'));
  assert.throws(() => sameGitlabRepository('https://gitlab.internal/another/repo.git', 'https://gitlab.internal/sub'));
  assert.equal(sameGitlabRepository('https://gitlab.internal/sub/team/repo.git', 'https://gitlab.internal/sub'), 'https://gitlab.internal/sub/team/repo.git');
});
test('persistent state survives reopen and refuses missing encryption key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-store-')); process.env.ADMIN_BOOTSTRAP_PASSWORD = 'fixture-admin-password';
  const a = await new Store(dir).open(); a.state.connection = { token: a.seal('fixture-token') }; await a.save();
  const b = await new Store(dir).open(); assert.equal(b.connection().token, 'fixture-token');
  const stat = await fs.stat(path.join(dir, 'state.json')); assert.equal(stat.mode & 0o777, 0o600);
  await fs.rename(path.join(dir, 'master.key'), path.join(dir, 'master.key.backup'));
  await assert.rejects(new Store(dir).open(), /master.key/);
});
