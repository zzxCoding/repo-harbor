import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { engineTools } from './engine.mjs';
import { cleanError } from './security.mjs';
import { AccessTokens } from './access-tokens.mjs';

const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export class McpGateway {
  constructor(store, pool) {
    this.store = store; this.pool = pool; this.tokens = new AccessTokens(store); this.sessions = new Map(); this.inFlight = 0; this.pending = 0; this.accepting = true;
    this.timer = setInterval(() => { for (const session of this.sessions.values()) if (!session.active && Date.now() - session.lastUsed > 30 * 60_000) void session.server.close(); }, 60000);
    this.timer.unref();
  }
  authorized(request) {
    return Boolean(this.tokens.authenticate(request));
  }
  async handle(request, response, body) {
    const principal = this.tokens.authenticate(request);
    if (!principal) {
      response.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } })); return;
    }
    if (!this.accepting) { response.writeHead(503); response.end('Service shutting down'); return; }
    const sessionId = request.headers['mcp-session-id'];
    let session = sessionId ? this.sessions.get(sessionId) : null;
    if (sessionId && (!session || session.tokenId !== principal.id || session.tokenRevision !== principal.revision)) { response.writeHead(404); response.end('MCP session expired; initialize again'); return; }
    let initializing = false;
    if (!session) {
      if (request.method !== 'POST' || !isInitializeRequest(body)) { response.writeHead(400); response.end('MCP initialize required'); return; }
      if (this.sessions.size + this.pending >= 32) { response.writeHead(429); response.end('MCP session capacity reached'); return; }
      initializing = true; this.pending++;
      session = this.createSession(principal);
      try { await session.server.connect(session.transport); }
      catch(e) { this.pending--; throw e; }
    }
    session.lastUsed = Date.now(); session.active++;
    try { await session.transport.handleRequest(request, response, body); }
    finally { session.active--; if (initializing) { this.pending--; if (!session.id) await session.server.close(); } }
  }
  createSession(principal) {
    const session = { tokenId: principal.id, tokenRevision: principal.revision, snapshots: new Map(), engines: new Map(), lastUsed: Date.now(), active: 0 };
    const available = () => this.tokens.available(session.tokenId, session.tokenRevision);
    const assertAllowed = id => { if (!available().some(r => r.id === id)) throw new Error('仓库不可用或未授权'); };
    const server = new Server({ name: 'repo-harbor', version: '0.1.3' }, { capabilities: { tools: {} }, instructions: 'Use list_repos to choose a repository allowed by this token, then pass its id in repo to map/source tools. Only granted, enabled repositories are readable. A repository is pinned to its published commit on first use in this MCP session. Reconnect to read a newer commit or after permissions change.' });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      { name: 'list_repos', description: 'List only repositories granted to this token and enabled, with published commit, sync state, and any version already pinned in this session.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      ...engineTools.map(tool => ({ ...tool, description: `${tool.description} Pass repo from list_repos; returned repository metadata identifies the fixed source commit.`, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, repo: { type: 'string', description: 'Granted repository id or exact GitLab project path; optional when this token can access only one enabled repository.' } } } })),
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args = {} } = request.params;
      if (name === 'list_repos') {
        try { return asText({ repositories: available().map(r => ({ id: r.id, name: r.path, branch: r.current?.branch, commit: r.current?.commit, indexedAt: r.current?.indexedAt, status: r.status, lastError: r.lastError, sessionCommit: session.snapshots.get(r.id)?.commit })), sessionPolicy: 'pin repository on first tool call; reconnect for newer versions or changed token permissions' }); }
        catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
      }
      if (!engineTools.some(tool => tool.name === name)) return { isError: true, content: [{ type: 'text', text: '此工具未开放；AI 只能读取已发布地图和源码。' }] };
      if (this.inFlight >= 16) return { isError: true, content: [{ type: 'text', text: '查询繁忙，请稍后重试。' }] };
      this.inFlight++;
      try {
        const allowed = available();
        const repo = args.repo ? allowed.find(r => r.id === args.repo || r.path === args.repo) : allowed.length === 1 ? allowed[0] : null;
        if (!repo) throw new Error(args.repo ? '仓库不可用或未授权' : '请先调用 list_repos，选择一个获准仓库并传入 repo');
        if (!repo.current) throw new Error('此仓库尚未发布代码地图，请等待首次同步成功');
        let snapshot = session.snapshots.get(repo.id);
        if (!snapshot) {
          snapshot = structuredClone(repo.current);
          // Reserve the pin synchronously before await so simultaneous first calls cannot see two versions.
          session.snapshots.set(repo.id, snapshot);
        }
        let engine = session.engines.get(repo.id);
        if (!engine) {
          engine = await this.pool.ensure(snapshot);
          assertAllowed(repo.id);
          if (!session.engines.has(repo.id)) { session.engines.set(repo.id, engine); engine.references++; }
          else engine = session.engines.get(repo.id);
        }
        const { repo: ignored, ...arguments_ } = args;
        assertAllowed(repo.id);
        const result = await engine.call(name, arguments_);
        // A permission change can occur while parsing or reading. Never deliver
        // an already-started result after its token or repository was revoked.
        assertAllowed(repo.id);
        const metadata = { id: repo.id, name: snapshot.name, branch: snapshot.branch, commit: snapshot.commit, indexedAt: snapshot.indexedAt };
        return { ...result, content: result.content.map(block => {
          if (block.type !== 'text') return block;
          try { const value = JSON.parse(block.text); return { ...block, text: JSON.stringify({ ...value, repository: metadata }) }; }
          catch { return block; }
        }), _meta: { ...(result._meta || {}), repository: metadata } };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: cleanError(e, [], [this.store.dir]) }] }; }
      finally { this.inFlight--; }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true,
      onsessioninitialized: id => { session.id = id; this.sessions.set(id, session); } });
    session.server = server; session.transport = transport;
    server.onclose = () => {
      if (session.id) this.sessions.delete(session.id);
      for (const engine of session.engines.values()) engine.references--;
      session.engines.clear(); void this.pool.collect();
    };
    return session;
  }
  async revoke(tokenId) {
    const sessions = [...this.sessions.values()].filter(s => tokenId === undefined || s.tokenId === tokenId);
    for (const session of sessions) this.sessions.delete(session.id);
    await Promise.allSettled(sessions.map(s => s.server.close()));
  }
  async close() { this.accepting = false; clearInterval(this.timer); await this.revoke(); }
}
