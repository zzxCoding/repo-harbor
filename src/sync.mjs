import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sameGitlabRepository, cleanError } from './security.mjs';
import { DEFAULT_BUILD_TIMEOUT_MINUTES, buildPhases } from './build-progress.mjs';

export async function command(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const stop = () => {
      timedOut = true;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {} }, 1500).unref();
    };
    const timer = setTimeout(stop, options.timeout || 5 * 60_000);
    options.signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', stop);
      if (timedOut) reject(new Error('同步任务超时或已停止'));
      else if (code !== 0) reject(new Error(`${file} 退出码 ${code}：${stderr || stdout}`));
      else resolve(stdout.trim());
    });
  });
}
async function freeze(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await freeze(file);
    else if (item.isFile()) await fs.chmod(file, 0o444);
  }
  await fs.chmod(dir, 0o555);
}
export function addEvent(repo, kind, message) {
  repo.events = [...(repo.events || []), { time: new Date().toISOString(), kind, message }].slice(-60);
}
export class Synchronizer {
  constructor(store, pool) { this.store = store; this.pool = pool; this.queue = []; this.working = false; this.stopping = false; }
  async start() {
    const askpass = fileURLToPath(new URL('./askpass.mjs', import.meta.url));
    // The executable mode is part of the source/image, not a write to the read-only app directory.
    this.askpass = askpass;
    this.controller = new AbortController();
    for (const repo of this.store.state.repositories) {
      if (!repo.enabled) continue;
      repo.status = 'queued'; repo.stage = repo.current ? '恢复已发布版本' : '等待同步';
      this.enqueue(repo.id);
    }
    this.timer = setInterval(() => {
      for (const repo of this.store.state.repositories) if (repo.enabled && (!repo.nextRun || Date.parse(repo.nextRun) <= Date.now())) this.enqueue(repo.id);
    }, 15000);
    this.timer.unref();
  }
  enqueue(id) {
    if (this.stopping || this.runningId === id || this.queue.includes(id)) return false;
    const repo = this.store.state.repositories.find(r => r.id === id);
    if (!repo?.enabled) return false;
    this.queue.push(id); repo.status = 'queued'; repo.stage = '等待同步';
    void this.store.save().catch(e => console.error('保存任务状态失败：', cleanError(e)));
    void this.drain(); return true;
  }
  async drain() {
    if (this.working || this.stopping) return;
    this.working = true;
    try {
      while (this.queue.length && !this.stopping) {
        const id = this.queue.shift(); const repo = this.store.state.repositories.find(r => r.id === id);
        if (!repo?.enabled) continue;
        this.runningId = id;
        try { await this.sync(repo); } catch (e) {
          const connection = this.store.connection();
          if (repo.status === 'indexing' && repo.build) { repo.build.phase = 'failed'; repo.build.finishedAt = new Date().toISOString(); }
          repo.status = 'error'; repo.stage = '同步失败'; repo.lastError = cleanError(e, [connection?.token], [this.store.dir]);
          addEvent(repo, 'error', repo.lastError);
          console.error(`[同步失败] ${repo.id} | ${repo.lastError}`);
        } finally {
          repo.lastAttempt = new Date().toISOString();
          repo.nextRun = new Date(Date.now() + (repo.reschedule ? 0 : this.store.state.intervalMinutes * 60_000)).toISOString();
          delete repo.reschedule;
          if (!repo.enabled) { repo.status = 'paused'; repo.stage = '已暂停'; }
          this.runningId = null;
          await this.store.save();
          await this.pool.collect();
        }
      }
    } finally { this.working = false; }
  }
  async phase(repo, status, message) { repo.status = status; repo.stage = message; addEvent(repo, status, message); await this.store.save(); }
  async sync(repo) {
    const c = this.store.connection();
    if (!c) throw new Error('请先配置 GitLab 连接');
    const requestedBranch = repo.branch;
    const requestedUrl = sameGitlabRepository(repo.remoteUrl, c.baseUrl);
    if (repo.current) {
      await this.phase(repo, 'restoring', '恢复已发布版本');
      await this.pool.ensure(repo.current, { signal: this.controller.signal });
    }
    const mirror = path.join(this.store.dir, 'mirrors', `${repo.id}.git`);
    const authHome = path.join(this.store.dir, 'git-runtime', repo.id);
    await fs.mkdir(authHome, { recursive: true, mode: 0o700 });
    let caPath;
    if (c.caPem) { caPath = path.join(authHome, 'ca.pem'); await fs.writeFile(caPath, c.caPem, { mode: 0o600 }); }
    const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: authHome,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: this.askpass, ATLAS_GIT_USERNAME: c.username, ATLAS_GIT_TOKEN: c.token,
      ...(caPath ? { GIT_SSL_CAINFO: caPath } : {}),
    };
    const git = args => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.file.allow=never', '-c', 'http.followRedirects=false', ...args], { env, signal: this.controller.signal });
    await git(['check-ref-format', '--branch', requestedBranch]);
    await this.phase(repo, 'fetching', `获取 ${requestedBranch} 最新代码`);
    try { await fs.access(path.join(mirror, 'HEAD')); } catch {
      await fs.mkdir(path.dirname(mirror), { recursive: true }); await git(['init', '--bare', mirror]);
      await git(['--git-dir', mirror, 'remote', 'add', 'origin', requestedUrl]);
    }
    await git(['--git-dir', mirror, 'remote', 'set-url', 'origin', requestedUrl]);
    await git(['--git-dir', mirror, 'fetch', '--depth=1', '--no-tags', 'origin', `refs/heads/${requestedBranch}`]);
    const commit = await git(['--git-dir', mirror, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Git 返回的 commit 格式错误');
    if (repo.current?.commit === commit && repo.current?.branch === requestedBranch) {
      repo.status = 'ready'; repo.stage = '代码未变化'; repo.lastError = null; repo.lastSuccess = new Date().toISOString();
      addEvent(repo, 'ready', `代码未变化，继续服务 ${commit.slice(0, 12)}`); return;
    }
    const parent = path.join(this.store.dir, 'snapshots', repo.id, commit);
    const root = path.join(parent, 'source');
    const complete = path.join(parent, 'source.complete');
    try { await fs.access(complete); } catch {
      // A failed extraction is never served. Use a fresh directory, then publish it under a stable commit path.
      const temp = `${parent}.building-${Date.now()}`;
      await fs.mkdir(path.join(temp, 'source'), { recursive: true });
      const archive = path.join(temp, 'source.tar');
      // Preserve source Git blobs instead of applying release-export filtering/substitution.
      await fs.mkdir(path.join(mirror, 'info'), { recursive: true });
      await fs.writeFile(path.join(mirror, 'info', 'attributes'), '* -export-ignore -export-subst\n');
      await git(['--git-dir', mirror, 'archive', '--format=tar', `--output=${archive}`, commit]);
      await command('tar', ['-xf', archive, '-C', path.join(temp, 'source')], { env: { PATH: env.PATH }, signal: this.controller.signal });
      await fs.unlink(archive); await freeze(path.join(temp, 'source'));
      await fs.writeFile(path.join(temp, 'source.complete'), commit, { mode: 0o444 });
      await fs.mkdir(path.dirname(parent), { recursive: true }); await fs.rename(temp, parent);
    }
    const snapshot = { repoId: repo.id, name: repo.path, branch: requestedBranch, commit, root,
      cache: path.join(this.store.dir, 'indexes', repo.id, commit), indexedAt: new Date().toISOString() };
    repo.build = { commit, startedAt: new Date().toISOString(), timeoutMinutes: this.store.state.buildTimeoutMinutes ?? DEFAULT_BUILD_TIMEOUT_MINUTES, phase: 'starting' };
    await this.phase(repo, 'indexing', `建立 ${commit.slice(0, 12)} 的代码地图`);
    let lastSaved = 0;
    const engine = await this.pool.ensure(snapshot, { startupTimeoutMs: repo.build.timeoutMinutes * 60_000, signal: this.controller.signal, onProgress: progress => {
      if (!this.store.state.repositories.includes(repo)) return;
      const changedPhase = repo.build.phase !== progress.phase;
      repo.build = { ...repo.build, ...progress, updatedAt: new Date().toISOString() };
      if (changedPhase && ['symbols', 'ready'].includes(progress.phase)) addEvent(repo, 'indexing', `${buildPhases[progress.phase]}；已用 ${Math.floor(progress.elapsedMs / 1000)} 秒`);
      if (Date.now() - lastSaved >= 5000 || changedPhase) {
        lastSaved = Date.now(); void this.store.save().catch(e => console.error('保存建图进度失败：', cleanError(e)));
      }
    } });
    repo.build.phase = 'validating';
    const probe = await engine.call('orient', { budget: 'small' });
    if (probe.isError) throw new Error(`新版本地图查询未通过，继续保留旧版本：${probe.content?.find(c => c.type === 'text')?.text || '未知错误'}`);
    if (!repo.enabled || repo.branch !== requestedBranch || !this.store.state.repositories.includes(repo) || this.store.connection()?.baseUrl !== c.baseUrl) {
      repo.status = 'queued'; repo.stage = '配置已变化，等待重新同步'; repo.reschedule = true;
      addEvent(repo, 'queued', '配置已变化，本轮结果不发布'); return;
    }
    snapshot.indexedAt = new Date().toISOString();
    repo.current = snapshot; repo.status = 'ready'; repo.stage = '已发布'; repo.lastError = null;
    repo.build.phase = 'ready'; repo.build.finishedAt = new Date().toISOString();
    repo.lastSuccess = new Date().toISOString();
    addEvent(repo, 'ready', `已发布 ${requestedBranch} @ ${commit.slice(0, 12)}`);
    await this.store.save();
  }
  async stop() { this.stopping = true; clearInterval(this.timer); this.controller?.abort(); while (this.working) await new Promise(r => setTimeout(r, 100)); }
}
