import crypto from 'node:crypto';
import { equalSecret, randomToken } from './security.mjs';

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export const tokenMetadata = ({ id, name, repositoryIds, enabled, legacy, createdAt, updatedAt }) => ({ id, name, repositoryIds: [...repositoryIds], enabled, legacy: Boolean(legacy), createdAt, updatedAt });
export class AccessTokens {
  constructor(store) { this.store = store; }
  list() { return this.store.state.accessTokens.map(tokenMetadata); }
  get(id) { const token = this.store.state.accessTokens.find(t => t.id === id); if (!token) fail(404, '读取令牌不存在'); return token; }
  legacy() { const token = this.store.state.accessTokens.find(t => t.legacy); if (!token) fail(404, '请在 AI 接入中创建读取令牌'); return token; }
  input(body, current) {
    const name = body.name === undefined ? current?.name : body.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) fail(400, '令牌名称需为 1–80 个字符');
    const ids = body.repositoryIds === undefined ? current?.repositoryIds : body.repositoryIds;
    if (!Array.isArray(ids) || ids.length > 5000 || ids.some(id => typeof id !== 'string')) fail(400, '请选择允许访问的仓库');
    const repositoryIds = [...new Set(ids)];
    const known = new Set(this.store.state.repositories.map(r => r.id));
    // Removed repositories may remain in saved legacy scopes, but cannot be newly granted.
    if (body.repositoryIds !== undefined && repositoryIds.some(id => !known.has(id))) fail(400, '所选仓库不存在，请刷新后重试');
    if (!current && !repositoryIds.length) fail(400, '新令牌至少选择一个仓库');
    const enabled = body.enabled === undefined ? current?.enabled ?? true : body.enabled;
    if (typeof enabled !== 'boolean') fail(400, '令牌启用状态无效');
    return { name: name.trim(), repositoryIds, enabled };
  }
  async create(body) {
    if (this.store.state.accessTokens.length >= 64) fail(400, '最多创建 64 个读取令牌');
    const input = this.input(body); const now = new Date().toISOString();
    const token = { id: crypto.randomUUID(), ...input, secret: this.store.seal(randomToken()), revision: 1, createdAt: now, updatedAt: now };
    this.store.state.accessTokens.push(token); await this.store.save(); return tokenMetadata(token);
  }
  async update(id, body) {
    const token = this.get(id); const input = this.input(body, token);
    Object.assign(token, input, { revision: token.revision + 1, updatedAt: new Date().toISOString() });
    await this.store.save(); return tokenMetadata(token);
  }
  async rotate(id) {
    const token = this.get(id); token.secret = this.store.seal(randomToken()); token.revision++; token.updatedAt = new Date().toISOString();
    await this.store.save(); return tokenMetadata(token);
  }
  async remove(id) { this.get(id); this.store.state.accessTokens = this.store.state.accessTokens.filter(t => t.id !== id); await this.store.save(); }
  authenticate(request) {
    const header = request.headers.authorization;
    const value = typeof header === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/i.test(header) ? header.slice(7) : '';
    if (!value) return null;
    return this.store.state.accessTokens.find(t => t.enabled && equalSecret(value, this.store.unseal(t.secret))) || null;
  }
  available(id, revision) {
    const token = this.store.state.accessTokens.find(t => t.id === id && t.enabled && t.revision === revision);
    if (!token) throw new Error('读取权限已变更，请重新连接 MCP');
    const ids = new Set(token.repositoryIds);
    return this.store.state.repositories.filter(r => r.enabled && ids.has(r.id));
  }
}
