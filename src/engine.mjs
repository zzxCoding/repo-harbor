import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { listCodegraphMcpTools } from '@lzehrung/codegraph/mcp';
import { DEFAULT_BUILD_TIMEOUT_MINUTES, buildPhases, decodeProgress } from './build-progress.mjs';

const reader = fileURLToPath(new URL('./reader.mjs', import.meta.url));
export const engineTools = listCodegraphMcpTools().filter(t => !['artifact_build', 'refresh_index', 'query_sqlite'].includes(t.name));
export class Engine {
  constructor(snapshot, dataDir, options = {}) { this.snapshot = snapshot; this.dataDir = dataDir; this.options = options; this.closed = false; this.logs = ''; this.references = 0; }
  async start() {
    const started = Date.now();
    const timeout = this.options.startupTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MINUTES * 60_000;
    let pending = '', lastLog = 0, acceptingProgress = true;
    const log = () => {
      lastLog = Date.now(); this.lastLoggedPhase = this.progress.phase;
      const counts = this.progress.phase === 'indexing' && this.progress.total > 0 ? ` ${this.progress.current}/${this.progress.total} 文件` : '';
      console.log(`[建图] ${this.snapshot.repoId} @ ${this.snapshot.commit.slice(0, 12)} | ${buildPhases[this.progress.phase]}${counts} | 已用 ${Math.floor((Date.now() - started) / 1000)} 秒 | 上限 ${timeout / 60000} 分钟`);
    };
    const notify = update => {
      this.progress = { ...this.progress, ...update, elapsedMs: Date.now() - started };
      this.options.onProgress?.(this.progress);
      if (Date.now() - lastLog >= 15000 || this.lastLoggedPhase !== update.phase) log();
    };
    notify({ phase: 'starting' });
    const home = path.join(this.dataDir, 'runtime', this.snapshot.repoId, this.snapshot.commit);
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(this.snapshot.cache, { recursive: true });
    this.transport = new StdioClientTransport({ command: process.execPath,
      args: [this.options.readerPath || reader, this.snapshot.root, this.snapshot.commit],
      cwd: this.snapshot.root, stderr: 'pipe',
      env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: home,
        CODEGRAPH_CACHE_DIR: this.snapshot.cache, NODE_COMPILE_CACHE: path.join(this.snapshot.cache, 'compile'),
        NODE_ENV: 'production', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    // SDK initialization can initiate a close before our catch block. Share that close
    // promise so timeout/shutdown await child termination and cannot leave a second reader.
    const transportClose = this.transport.close.bind(this.transport);
    this.transport.close = () => this.transportClosing ??= transportClose();
    this.transport.stderr?.on('data', chunk => {
      const text = chunk.toString(); this.logs = (this.logs + text).slice(-16000); pending = (pending + text).slice(-32000);
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) { const update = decodeProgress(line); if (update && acceptingProgress) notify(update); }
    });
    this.client = new Client({ name: 'repo-harbor-reader', version: '0.2.1' }, { capabilities: {} });
    this.client.onclose = () => { this.closed = true; };
    const abort = () => void this.close();
    this.options.signal?.addEventListener('abort', abort, { once: true });
    const heartbeat = setInterval(log, 15000); heartbeat.unref();
    try {
      if (this.options.signal?.aborted) throw new Error('建图已停止');
      await this.client.connect(this.transport, { timeout });
      const result = await this.client.listTools();
      if (!result.tools.some(t => t.name === 'get_file')) throw new Error('代码地图未提供源码工具');
    } catch (e) {
      acceptingProgress = false;
      notify({ phase: 'failed' }); await this.close();
      if (e.code === -32001) throw new Error(`建图超时：达到 ${timeout / 60000} 分钟上限；已处理 ${this.progress.current ?? 0}/${this.progress.total ?? '?'} 个文件。可在管理设置调整建图超时后重试。`);
      throw new Error(`建图失败：${e.message}\n${this.logs.slice(-2000)}`);
    } finally { acceptingProgress = false; clearInterval(heartbeat); this.options.signal?.removeEventListener('abort', abort); }
    return this;
  }
  async call(name, args) {
    if (this.closed) throw new Error('查询进程已停止，请重新同步此仓库');
    return await this.client.callTool({ name, arguments: args }, undefined, { timeout: 5 * 60_000, resetTimeoutOnProgress: true, maxTotalTimeout: 5 * 60_000 });
  }
  async close() { this.closed = true; await this.client?.close().catch(() => {}); await this.transport?.close().catch(() => {}); }
}
export class EnginePool {
  constructor(store) { this.store = store; this.engines = new Map(); this.starting = new Map(); }
  key(s) { return `${s.repoId}:${s.commit}`; }
  async ensure(snapshot, options = {}) {
    const key = this.key(snapshot);
    const existing = this.engines.get(key);
    if (existing && !existing.closed) return existing;
    if (this.starting.has(key)) return this.starting.get(key);
    const promise = new Engine(snapshot, this.store.dir, { startupTimeoutMs: (this.store.state.buildTimeoutMinutes ?? DEFAULT_BUILD_TIMEOUT_MINUTES) * 60_000, ...options }).start().then(engine => { this.engines.set(key, engine); return engine; }).finally(() => this.starting.delete(key));
    this.starting.set(key, promise);
    return promise;
  }
  async collect() {
    const current = new Set(this.store.state.repositories.filter(r => r.enabled && r.current).map(r => this.key(r.current)));
    for (const [key, engine] of this.engines) if (!current.has(key) && engine.references === 0) { this.engines.delete(key); await engine.close(); }
  }
  async close() { await Promise.allSettled([...this.engines.values()].map(e => e.close())); this.engines.clear(); }
}
