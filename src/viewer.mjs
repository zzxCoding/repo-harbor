import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomToken } from './security.mjs';
import { VIEWER_SCHEMA } from './viewer-export.mjs';

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
const within = (root, file) => file.startsWith(root + path.sep);
export async function readSnapshotSource(snapshot, file, offset = 1, limit = 200) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.git') || /[\0\r\n]/.test(file)) fail(400, '源码路径无效');
  if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, '源码页码无效');
  const root = await fs.realpath(snapshot.root); const target = path.resolve(root, file);
  if (!within(root, target)) fail(403, '源码路径超出当前版本');
  const real = await fs.realpath(target);
  if (!within(root, real)) fail(403, '源码链接指向当前版本以外');
  const before = await fs.stat(real);
  if (!before.isFile() || before.size > 5 * 1024 * 1024) fail(413, '当前文件超过 5 MiB，无法在页面预览');
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || await fs.realpath(target) !== real) fail(409, '源码文件在读取时发生变化，请重新打开地图');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || await fs.realpath(target) !== real) fail(409, '源码文件在读取时发生变化，请重新打开地图');
    if (bytes.includes(0)) fail(415, '当前文件为二进制，无法在页面预览');
    const lines = bytes.toString('utf8').split(/\r?\n/);
    const selected = lines.slice(offset - 1, offset - 1 + limit); let used = 0;
    const bounded = [];
    for (const line of selected) {
      if (used + Buffer.byteLength(line) > 512 * 1024) { if (!bounded.length) bounded.push(line.slice(0, 128 * 1024)); break; }
      bounded.push(line); used += Buffer.byteLength(line);
    }
    return { file, offset, lines: bounded, totalLines: lines.length, nextOffset: offset + bounded.length <= lines.length ? offset + bounded.length : null, truncated: bounded.length < selected.length || bounded.some((line, i) => line !== selected[i]) };
  } finally { await handle.close(); }
}
export class Viewer {
  constructor(store) { this.store = store; this.pins = new Map(); this.timer = setInterval(() => this.prune(), 60000); this.timer.unref(); }
  close() { clearInterval(this.timer); this.pins.clear(); }
  prune() { for (const [id, pin] of this.pins) if (pin.until < Date.now()) this.pins.delete(id); }
  async open(sid, repoId, commit) {
    this.prune();
    const repo = this.store.state.repositories.find(r => r.id === repoId);
    if (!repo?.enabled) fail(404, '仓库不存在或已暂停');
    if (!repo.current) fail(409, '仓库尚未发布，请等待建图完成');
    if (commit && commit !== repo.current.commit) fail(409, '仓库已有新发布版本，请从仓库详情重新打开地图');
    const snapshot = { ...repo.current }; let graph;
    try { graph = JSON.parse(await fs.readFile(path.join(snapshot.cache, 'viewer-v1', 'manifest.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { preparing: true, message: '正在为已有地图准备查看数据，请稍候', repository: this.metadata(repo, snapshot) }; throw error; }
    if (graph.schemaVersion !== VIEWER_SCHEMA || graph.commit !== snapshot.commit) fail(409, '查看地图数据与发布版本不一致，请重新同步');
    const key = `${sid}:${repoId}:${snapshot.commit}`;
    let entry = [...this.pins.entries()].find(([, p]) => p.key === key);
    if (!entry) {
      if (this.pins.size >= 64) fail(429, '打开的地图过多，请稍后重试');
      const id = randomToken(); const pin = { key, sid, repoId, snapshot, files: graph.files, until: Date.now() + 30 * 60_000 };
      this.pins.set(id, pin); entry = [id, pin];
    }
    entry[1].until = Date.now() + 30 * 60_000;
    return { viewId: entry[0], repository: this.metadata(repo, snapshot), graph };
  }
  metadata(repo, snapshot) { return { id: repo.id, name: snapshot.name, branch: snapshot.branch, commit: snapshot.commit, indexedAt: snapshot.indexedAt }; }
  pin(sid, id) {
    this.prune(); const pin = this.pins.get(id);
    if (!pin || pin.sid !== sid) fail(404, '地图会话已过期，请重新打开');
    if (!this.store.state.repositories.some(r => r.id === pin.repoId && r.enabled)) { this.pins.delete(id); fail(404, '仓库已暂停或移除，地图访问已停止'); }
    pin.until = Date.now() + 30 * 60_000; return pin;
  }
  index(pin, file) { const index = pin.files.indexOf(file); if (index < 0) fail(404, '文件不在当前地图中'); return index; }
  async file(sid, id, file, offset, limit) {
    const pin = this.pin(sid, id); this.index(pin, file);
    const [source, symbols] = await Promise.all([
      readSnapshotSource(pin.snapshot, file, offset, limit),
      fs.readFile(path.join(pin.snapshot.cache, 'viewer-v1', 'symbols', `${this.index(pin, file)}.json`), 'utf8').then(JSON.parse),
    ]);
    return { ...source, ...symbols, repository: this.metadata({ id: pin.repoId }, pin.snapshot) };
  }
}
