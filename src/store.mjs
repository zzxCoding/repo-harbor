import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { encrypt, decrypt, passwordHash, randomToken } from './security.mjs';
import { DEFAULT_BUILD_TIMEOUT_MINUTES } from './build-progress.mjs';
import { tokenMetadata } from './access-tokens.mjs';

export class Store {
  constructor(dir) { this.dir = path.resolve(dir); this.writes = Promise.resolve(); }
  async open() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.keyPath = path.join(this.dir, 'master.key');
    this.file = path.join(this.dir, 'state.json');
    let exists = true;
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('持久化配置损坏；请恢复数据卷备份，服务不会覆盖原文件');
      exists = false;
    }
    try { this.key = await fs.readFile(this.keyPath); } catch (e) {
      if (e.code !== 'ENOENT' || exists) throw new Error('数据卷加密密钥不可读；请恢复原 master.key');
      this.key = crypto.randomBytes(32);
      await fs.writeFile(this.keyPath, this.key, { flag: 'wx', mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error('数据卷加密密钥格式错误');
    if (!exists) {
      const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || randomToken();
      this.state = { version: 2, auth: await passwordHash(password), accessTokens: [], connection: null, repositories: [], intervalMinutes: 15, buildTimeoutMinutes: DEFAULT_BUILD_TIMEOUT_MINUTES };
      if (!process.env.ADMIN_BOOTSTRAP_PASSWORD) console.log(`首次管理密码：${password}`);
      await this.save();
    }
    if (![1, 2].includes(this.state.version) || !Array.isArray(this.state.repositories)) throw new Error('不支持的数据格式版本');
    if (this.state.connection) this.unseal(this.state.connection.token);
    if (this.state.version === 1) {
      if (!this.state.mcpToken || !this.unseal(this.state.mcpToken)) throw new Error('原读取令牌不可读；请恢复数据卷备份');
      const now = new Date().toISOString();
      this.state.accessTokens = [{ id: crypto.randomUUID(), name: '原有读取令牌', secret: this.state.mcpToken, repositoryIds: this.state.repositories.map(r => r.id), enabled: true, legacy: true, revision: 1, createdAt: now, updatedAt: now }];
      delete this.state.mcpToken; this.state.version = 2; await this.save();
    }
    if (!Array.isArray(this.state.accessTokens) || this.state.accessTokens.length > 64) throw new Error('读取令牌配置损坏；请恢复数据卷备份');
    const ids = new Set();
    for (const token of this.state.accessTokens) {
      if (typeof token.id !== 'string' || !/^[a-f0-9-]{36}$/.test(token.id) || ids.has(token.id) || typeof token.name !== 'string' || !token.name.trim() || !Array.isArray(token.repositoryIds) || token.repositoryIds.some(id => typeof id !== 'string') || typeof token.enabled !== 'boolean' || !Number.isSafeInteger(token.revision) || token.revision < 1 || !/^[A-Za-z0-9_-]{43}$/.test(this.unseal(token.secret))) throw new Error('读取令牌配置损坏；请恢复数据卷备份');
      ids.add(token.id);
    }
    return this;
  }
  seal(value) { return encrypt(value, this.key); }
  unseal(value) { return decrypt(value, this.key); }
  connection() {
    const c = this.state.connection;
    return c ? { ...c, token: this.unseal(c.token) } : null;
  }
  save() {
    const content = JSON.stringify(this.state, null, 2) + '\n';
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, this.file);
      const dir = await fs.open(this.dir, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    });
    return this.writes;
  }
  publicState() {
    const connection = this.state.connection;
    return { version: '0.1.3', codegraphVersion: '3.0.0', intervalMinutes: this.state.intervalMinutes, buildTimeoutMinutes: this.state.buildTimeoutMinutes ?? DEFAULT_BUILD_TIMEOUT_MINUTES, accessTokens: this.state.accessTokens.map(tokenMetadata),
      connection: connection ? { baseUrl: connection.baseUrl, username: connection.username, group: connection.group, caPem: connection.caPem || '', hasToken: true } : null,
      repositories: this.state.repositories.map(r => ({ ...r, events: r.events?.slice(-40) || [] })) };
  }
}
