import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { encrypt, decrypt, passwordHash, randomToken } from './security.mjs';
import { DEFAULT_BUILD_TIMEOUT_MINUTES } from './build-progress.mjs';
import { tokenMetadata } from './access-tokens.mjs';
import { sourceInput, sourceSummary, sourceTypes } from './sources.mjs';

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
      this.state = { version: 3, auth: await passwordHash(password), accessTokens: [], connections: [], repositories: [], intervalMinutes: 15, buildTimeoutMinutes: DEFAULT_BUILD_TIMEOUT_MINUTES };
      if (!process.env.ADMIN_BOOTSTRAP_PASSWORD) console.log(`首次管理密码：${password}`);
      await this.save();
    }
    if (![1, 2, 3].includes(this.state.version) || !Array.isArray(this.state.repositories)) throw new Error('不支持的数据格式版本');
    const originalVersion = this.state.version;
    if (this.state.connection) this.unseal(this.state.connection.token);
    if (this.state.version === 1) {
      if (!this.state.mcpToken || !this.unseal(this.state.mcpToken)) throw new Error('原读取令牌不可读；请恢复数据卷备份');
      const now = new Date().toISOString();
      this.state.accessTokens = [{ id: crypto.randomUUID(), name: '原有读取令牌', secret: this.state.mcpToken, repositoryIds: this.state.repositories.map(r => r.id), enabled: true, legacy: true, revision: 1, createdAt: now, updatedAt: now }];
      delete this.state.mcpToken; this.state.version = 2;
    }
    if (this.state.version === 2) {
      const old = this.state.connection;
      if (!old && this.state.repositories.length) throw new Error('原代码源连接缺失；请恢复数据卷备份');
      this.state.connections = old ? [{ ...old, id: crypto.randomUUID(), type: 'gitlab', name: '原有 GitLab 连接', anonymous: false, revision: 1 }] : [];
      for (const repo of this.state.repositories) {
        repo.connectionId = this.state.connections[0].id;
        repo.externalId = String(repo.projectId ?? repo.path ?? repo.id);
      }
      delete this.state.connection; this.state.version = 3;
    }
    if (!Array.isArray(this.state.accessTokens) || this.state.accessTokens.length > 64) throw new Error('读取令牌配置损坏；请恢复数据卷备份');
    const ids = new Set();
    for (const token of this.state.accessTokens) {
      if (typeof token.id !== 'string' || !/^[a-f0-9-]{36}$/.test(token.id) || ids.has(token.id) || typeof token.name !== 'string' || !token.name.trim() || !Array.isArray(token.repositoryIds) || token.repositoryIds.some(id => typeof id !== 'string') || typeof token.enabled !== 'boolean' || !Number.isSafeInteger(token.revision) || token.revision < 1 || !/^[A-Za-z0-9_-]{43}$/.test(this.unseal(token.secret))) throw new Error('读取令牌配置损坏；请恢复数据卷备份');
      ids.add(token.id);
    }
    if (!Array.isArray(this.state.connections) || this.state.connections.length > 32) throw new Error('代码源连接配置损坏；请恢复数据卷备份');
    const connectionIds = new Set();
    for (const c of this.state.connections) {
      if (typeof c.id !== 'string' || !/^[a-f0-9-]{36}$/.test(c.id) || connectionIds.has(c.id) || !Object.hasOwn(sourceTypes, c.type) || typeof c.name !== 'string' || !Number.isSafeInteger(c.revision) || c.revision < 1) throw new Error('代码源连接配置损坏；请恢复数据卷备份');
      sourceInput({ ...c, token: this.unseal(c.token) }); connectionIds.add(c.id);
    }
    if (this.state.repositories.some(r => !connectionIds.has(r.connectionId) || typeof r.externalId !== 'string')) throw new Error('仓库所属代码源配置损坏；请恢复数据卷备份');
    if (originalVersion !== this.state.version) await this.save();
    return this;
  }
  seal(value) { return encrypt(value, this.key); }
  unseal(value) { return decrypt(value, this.key); }
  connection(id) {
    const c = id ? this.state.connections.find(c => c.id === id) : this.state.connections.length === 1 ? this.state.connections[0] : null;
    return c ? { ...c, token: this.unseal(c.token) } : null;
  }
  connectionSecrets() { return this.state.connections.map(c => this.unseal(c.token)); }
  publicConnection(c) { return { ...sourceSummary(c), username: c.username, group: c.group, caPem: c.caPem || '', anonymous: c.anonymous, hasToken: Boolean(this.unseal(c.token)), revision: c.revision }; }
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
    const connections = this.state.connections.map(c => this.publicConnection(c));
    return { version: '0.2.1', codegraphVersion: '3.0.0', intervalMinutes: this.state.intervalMinutes, buildTimeoutMinutes: this.state.buildTimeoutMinutes ?? DEFAULT_BUILD_TIMEOUT_MINUTES, accessTokens: this.state.accessTokens.map(tokenMetadata), connections,
      connection: connections.length === 1 ? connections[0] : null,
      repositories: this.state.repositories.map(r => ({ ...r, source: sourceSummary(this.state.connections.find(c => c.id === r.connectionId)), events: r.events?.slice(-40) || [] })) };
  }
}
