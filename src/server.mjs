import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { EnginePool } from './engine.mjs';
import { Synchronizer, addEvent } from './sync.mjs';
import { McpGateway } from './mcp.mjs';
import { connectionInput, apiGet, projects, project, branches } from './gitlab.mjs';
import { passwordMatches, passwordHash, randomToken, cleanError } from './security.mjs';
import { buildTimeoutMinutes } from './build-progress.mjs';
import { Viewer } from './viewer.mjs';
import { createRequire } from 'node:module';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const require = createRequire(import.meta.url);
const vendorDir = path.join(path.dirname(path.dirname(require.resolve('@lzehrung/codegraph'))), 'src/viewer/vendor');
const mapAssets = { '/map': [path.join(publicDir, 'viewer.html'), 'text/html'], '/viewer.js': [path.join(publicDir, 'viewer.js'), 'text/javascript'], '/viewer.css': [path.join(publicDir, 'viewer.css'), 'text/css'] };
for (const name of ['graphology.js', 'sigma.js', 'graphology-layout-forceatlas2.js']) mapAssets[`/viewer-vendor/${name}`] = [path.join(vendorDir, name), 'text/javascript'];
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function readBody(request, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) { const e = new Error('请求内容超过限制'); e.status = 413; throw e; } chunks.push(chunk); }
  if (!size) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { const e = new Error('请求必须为有效 JSON'); e.status = 400; throw e; }
}
function validBranch(branch) {
  if (typeof branch !== 'string' || !branch || branch.length > 200 || branch.startsWith('-') || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.includes('@{')) throw new Error('分支名称格式错误');
  return branch;
}
export async function startService(options = {}) {
  const store = await new Store(options.dataDir || process.env.DATA_DIR || '/data').open();
  const pool = new EnginePool(store); const sync = new Synchronizer(store, pool); const mcp = new McpGateway(store, pool);
  const viewer = new Viewer(store);
  const sessions = new Map(); const attempts = new Map(); let stopping = false;
  const sessionFor = request => {
    const sid = (request.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('atlas_session='))?.slice(14);
    const session = sessions.get(sid);
    return session && session.until > Date.now() ? { sid, ...session } : null;
  };
  const cookie = (request, token, age) => `atlas_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    try {
      const url = new URL(request.url, 'http://service.local'); const route = url.pathname; const method = request.method;
      if (route === '/healthz' && method === 'GET') return json(response, 200, { status: stopping ? 'stopping' : 'ok', version: '0.1.3' });
      // Browser requests must originate from the same visible host, including behind a Host-preserving TLS proxy.
      if (request.headers.origin) {
        let origin;
        try { origin = new URL(request.headers.origin); } catch {}
        if (!origin || origin.host !== request.headers.host || !['http:', 'https:'].includes(origin.protocol)) return json(response, 403, { error: '拒绝跨站请求' });
      }
      if (route === '/mcp') {
        if (!['GET', 'POST', 'DELETE'].includes(method)) return json(response, 405, { error: 'Method not allowed' });
        if (!mcp.authorized(request)) return await mcp.handle(request, response);
        const body = method === 'POST' ? await readBody(request) : undefined;
        await mcp.handle(request, response, body); return;
      }
      if (mapAssets[route] && ['GET', 'HEAD'].includes(method)) {
        if (!sessionFor(request)) {
          if (route === '/map') { response.writeHead(302, { Location: '/' }); response.end(); return; }
          return json(response, 401, { error: '请登录管理页面' });
        }
        const [file, type] = mapAssets[route]; const bytes = await fs.readFile(file);
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Length': bytes.length }); response.end(method === 'HEAD' ? undefined : bytes); return;
      }
      if (staticFiles[route] && ['GET', 'HEAD'].includes(method)) {
        const [file, type] = staticFiles[route]; const bytes = await fs.readFile(path.join(publicDir, file));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', 'Content-Length': bytes.length }); response.end(method === 'HEAD' ? undefined : bytes); return;
      }
      if (!route.startsWith('/api/')) return json(response, 404, { error: '页面不存在' });
      if (route === '/api/session' && method === 'GET') return json(response, 200, { authenticated: Boolean(sessionFor(request)) });
      if (method !== 'GET' && !String(request.headers['content-type'] || '').startsWith('application/json')) return json(response, 415, { error: '请使用 application/json' });
      const body = method === 'GET' ? {} : (await readBody(request, 256000) || {});
      if (route === '/api/login' && method === 'POST') {
        const ip = request.socket.remoteAddress || 'local'; const now = Date.now();
        const old = attempts.get(ip); const entry = old && old.since > now - 5 * 60_000 ? old : { count: 0, since: now };
        if (++entry.count > 12) return json(response, 429, { error: '登录尝试过多，请 5 分钟后重试' });
        attempts.set(ip, entry);
        if (!await passwordMatches(body.password, store.state.auth)) return json(response, 401, { error: '管理密码不正确' });
        attempts.delete(ip);
        if (sessions.size > 256) sessions.delete(sessions.keys().next().value);
        const sid = randomToken(); sessions.set(sid, { until: Date.now() + 8 * 60 * 60_000 });
        response.setHeader('Set-Cookie', cookie(request, sid, 8 * 60 * 60)); return json(response, 200, { ok: true });
      }
      const admin = sessionFor(request);
      if (!admin) return json(response, 401, { error: '请登录管理页面' });
      if (route === '/api/logout' && method === 'POST') { sessions.delete(admin.sid); response.setHeader('Set-Cookie', cookie(request, '', 0)); return json(response, 200, { ok: true }); }
      if (route === '/api/state' && method === 'GET') return json(response, 200, { ...store.publicState(), task: sync.runningId, queued: sync.queue.length, mcpSessions: mcp.sessions.size });
      const mapMatch = /^\/api\/repositories\/([a-f0-9-]{36})\/map$/.exec(route);
      if (mapMatch && method === 'GET') {
        const result = await viewer.open(admin.sid, mapMatch[1], url.searchParams.get('commit'));
        return json(response, result.preparing ? 202 : 200, result);
      }
      const fileMatch = /^\/api\/maps\/([A-Za-z0-9_-]{32,64})\/file$/.exec(route);
      if (fileMatch && method === 'GET') {
        return json(response, 200, await viewer.file(admin.sid, fileMatch[1], url.searchParams.get('file'), Number(url.searchParams.get('offset') || 1), Number(url.searchParams.get('limit') || 200)));
      }
      if (route === '/api/connection/test' && method === 'POST') {
        const c = connectionInput(body, store.connection()); const user = (await apiGet(c, 'user')).data;
        if (c.group) await apiGet(c, `groups/${encodeURIComponent(c.group)}`, { with_projects: false });
        return json(response, 200, { ok: true, username: user.username || 'GitLab 用户' });
      }
      if (route === '/api/connection' && method === 'PUT') {
        const c = connectionInput(body, store.connection());
        if (store.state.connection?.baseUrl !== c.baseUrl && store.state.repositories.length) throw new Error('更换 GitLab 服务前，请先移除现有仓库配置；已有快照不会删除');
        await apiGet(c, 'user'); if (c.group) await apiGet(c, `groups/${encodeURIComponent(c.group)}`, { with_projects: false });
        store.state.connection = { ...c, token: store.seal(c.token) }; await store.save();
        return json(response, 200, { ok: true });
      }
      const c = store.connection();
      if (route === '/api/projects' && method === 'GET') {
        if (!c) throw new Error('请先保存 GitLab 连接');
        return json(response, 200, { projects: await projects(c, (url.searchParams.get('search') || '').slice(0, 100)) });
      }
      if (route === '/api/branches' && method === 'GET') {
        if (!c) throw new Error('请先保存 GitLab 连接');
        const id = url.searchParams.get('projectId'); if (!/^\d+$/.test(id || '')) throw new Error('项目 ID 格式错误');
        return json(response, 200, { branches: await branches(c, id) });
      }
      if (route === '/api/repositories' && method === 'POST') {
        if (!c) throw new Error('请先保存 GitLab 连接');
        const choices = body.projectPath ? [String(body.projectPath).trim()] : [...new Set(body.projectIds || [])];
        if (!choices.length || choices.length > 50 || choices.some(x => !['string', 'number'].includes(typeof x) || String(x).length > 300)) throw new Error('每次选择 1–50 个 GitLab 项目');
        const selected = [];
        for (const choice of choices) selected.push(await project(c, choice));
        const added = [];
        for (const p of selected) {
          if (store.state.repositories.some(r => r.projectId === p.projectId)) continue;
          const repo = { ...p, id: crypto.randomUUID(), branch: validBranch(body.branch || p.defaultBranch), enabled: true, status: 'queued', stage: '等待同步', current: null, events: [] };
          store.state.repositories.push(repo); added.push(repo.id);
        }
        await store.save(); for (const id of added) sync.enqueue(id);
        return json(response, 200, { added });
      }
      const match = /^\/api\/repositories\/([a-f0-9-]{36})$/.exec(route);
      if (match) {
        const repo = store.state.repositories.find(r => r.id === match[1]); if (!repo) return json(response, 404, { error: '仓库配置不存在' });
        if (method === 'PATCH') {
          if (body.branch !== undefined) { repo.branch = validBranch(body.branch); if (sync.runningId === repo.id) repo.reschedule = true; }
          if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw new Error('启用状态格式错误'); repo.enabled = body.enabled; }
          if (!repo.enabled) { repo.status = 'paused'; repo.stage = '已暂停'; }
          else { repo.nextRun = new Date().toISOString(); sync.enqueue(repo.id); }
          await store.save(); await pool.collect(); return json(response, 200, { ok: true });
        }
        if (method === 'DELETE') {
          store.state.repositories = store.state.repositories.filter(r => r !== repo);
          await store.save(); await pool.collect(); return json(response, 200, { ok: true, snapshotsRetained: true });
        }
      }
      if (route === '/api/sync' && method === 'POST') {
        const ids = body.id ? [body.id] : store.state.repositories.filter(r => r.enabled).map(r => r.id);
        return json(response, 202, { queued: ids.filter(id => sync.enqueue(id)).length });
      }
      if (route === '/api/schedule' && method === 'PUT') {
        const minutes = Number(body.intervalMinutes); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('同步间隔需为 1–1440 分钟');
        store.state.intervalMinutes = minutes;
        for (const repo of store.state.repositories) repo.nextRun = new Date(Date.now() + minutes * 60_000).toISOString();
        await store.save(); return json(response, 200, { ok: true });
      }
      if (route === '/api/access-tokens' && method === 'GET') return json(response, 200, { tokens: mcp.tokens.list() });
      if (route === '/api/access-tokens' && method === 'POST') return json(response, 201, { token: await mcp.tokens.create(body) });
      const accessMatch = /^\/api\/access-tokens\/([a-f0-9-]{36})(?:\/(secret|rotate))?$/.exec(route);
      if (accessMatch) {
        const [, id, action] = accessMatch;
        if (action === 'secret' && method === 'GET') return json(response, 200, { token: store.unseal(mcp.tokens.get(id).secret) });
        if (action === 'rotate' && method === 'POST') {
          const token = await mcp.tokens.rotate(id); await mcp.revoke(id); return json(response, 200, { token });
        }
        if (!action && method === 'PATCH') {
          const token = await mcp.tokens.update(id, body); await mcp.revoke(id); return json(response, 200, { token });
        }
        if (!action && method === 'DELETE') { await mcp.tokens.remove(id); await mcp.revoke(id); return json(response, 200, { ok: true }); }
      }
      // Compatibility is limited to the explicitly scoped legacy entry.
      if (route === '/api/mcp-token' && method === 'GET') return json(response, 200, { token: store.unseal(mcp.tokens.legacy().secret) });
      if (route === '/api/build-settings' && method === 'PUT') {
        store.state.buildTimeoutMinutes = buildTimeoutMinutes(body.timeoutMinutes);
        await store.save(); return json(response, 200, { ok: true });
      }
      if (route === '/api/mcp-token/rotate' && method === 'POST') {
        const id = mcp.tokens.legacy().id; await mcp.tokens.rotate(id); await mcp.revoke(id); return json(response, 200, { token: store.unseal(mcp.tokens.get(id).secret) });
      }
      if (route === '/api/password' && method === 'PUT') {
        if (!await passwordMatches(body.currentPassword, store.state.auth)) return json(response, 401, { error: '当前管理密码不正确' });
        store.state.auth = await passwordHash(body.newPassword); await store.save(); sessions.clear(); response.setHeader('Set-Cookie', cookie(request, '', 0)); return json(response, 200, { ok: true });
      }
      return json(response, 404, { error: '接口不存在' });
    } catch (e) {
      if (!response.headersSent) json(response, e.status || 400, { error: cleanError(e, [store.connection()?.token], [store.dir]) });
      else response.end();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? Number(process.env.PORT || 8093), options.host || process.env.HOST || '0.0.0.0', resolve); });
  await sync.start();
  const gc = setInterval(() => { for (const [id, s] of sessions) if (s.until < Date.now()) sessions.delete(id); for (const [id, a] of attempts) if (a.since < Date.now() - 5 * 60_000) attempts.delete(id); }, 60000); gc.unref();
  const close = async () => {
    if (stopping) return; stopping = true; clearInterval(gc);
    viewer.close(); await mcp.close(); await sync.stop(); await pool.close(); await store.writes;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  return { server, store, pool, sync, mcp, close, port: server.address().port };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await startService(); console.log(`代码地图服务已启动，端口 ${service.port}`);
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { if (closing) return; closing = true; const timer = setTimeout(() => process.exit(1), 20000); timer.unref(); void service.close().then(() => process.exit(0)); });
}
