import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { command } from '../src/sync.mjs';

export async function gitlabFixture({ multiProject = false, provider = 'gitlab', anonymous = false, host = '127.0.0.1', publicHost = '127.0.0.1', port = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-atlas-fixture-'));
  const source = path.join(root, 'source'); const remoteRoot = path.join(root, 'remotes'); const remote = path.join(remoteRoot, 'team/service.git');
  await fs.mkdir(path.join(source, 'src'), { recursive: true }); await fs.mkdir(path.dirname(remote), { recursive: true });
  const git = args => command('git', ['-c', 'user.name=RepoHarbor Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: source });
  await git(['init', '-b', 'main']); await command('git', ['init', '--bare', remote]);
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"fixture","type":"module"}\n');
  await fs.writeFile(path.join(source, 'README.md'), '# Fixture\n');
  await fs.writeFile(path.join(source, 'src/source.ts'), `export const sourceProvider = "${provider}";\n`);
  await fs.writeFile(path.join(source, '.gitattributes'), 'src/exported.ts export-ignore\nsrc/pricing.ts export-subst\n');
  await fs.writeFile(path.join(source, 'src/exported.ts'), 'export const rawGitBlob = "kept-in-source-snapshot";\n');
  await fs.writeFile(path.join(source, 'src/pricing.ts'), 'export function normalizePrice(value: number): number { return Math.max(0, value); }\nexport function calculatePrice(value: number): number { return normalizePrice(value) * 0.9; } // fixture-v1\n// $Format:%H$\n');
  await fs.writeFile(path.join(source, 'src/invoice.ts'), 'import * as pricing from "./pricing";\nexport function createInvoice(value: number): number { return pricing.calculatePrice(value); }\n');
  await fs.writeFile(path.join(source, 'src/markup.ts'), 'export const example = "<img src=x onerror=globalThis.viewerInjected=1>";\n');
  await fs.symlink('../../../../state.json', path.join(source, 'state-link.json'));
  await git(['add', '.']); await git(['commit', '-m', 'fixture-v1']); await git(['remote', 'add', 'origin', remote]); await git(['push', 'origin', 'main']);
  await git(['branch', 'release']); await git(['push', 'origin', 'release']);
  if (multiProject) {
    const privateSource = path.join(root, 'private-source'), privateRemote = path.join(remoteRoot, 'team/private.git');
    await fs.mkdir(path.join(privateSource, 'src'), { recursive: true });
    await command('git', ['init', '-b', 'main', privateSource]);
    await fs.writeFile(path.join(privateSource, 'src/private-only.ts'), 'export const privateValue = "PRIVATE_REPO_ONLY_CONTENT";\n');
    const privateGit = args => command('git', ['-c', 'user.name=RepoHarbor Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: privateSource });
    await privateGit(['add', '.']); await privateGit(['commit', '-m', 'private-fixture']); await command('git', ['clone', '--bare', privateSource, privateRemote]);
  }
  const token = `fixture-${provider}-token`, username = provider === 'github' ? 'x-access-token' : provider === 'git' ? 'git' : 'oauth2';
  const counters = { clone: 0, api: 0, invalidAuth: 0, wrongCredentials: 0 }; let rejectClone = false;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.local');
    const send = (status, data, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(data)); };
    const base = `http://${publicHost}:${server.address().port}`;
    if (provider === 'github' && url.pathname.startsWith('/api/v3/')) {
      counters.api++;
      const endpoint = decodeURIComponent(url.pathname.slice('/api/v3/'.length));
      if (endpoint === 'rate_limit') return send(200, { resources: { core: { remaining: 60 } } });
      if (!anonymous && request.headers.authorization !== `Bearer ${token}`) { counters.invalidAuth++; if (request.headers.authorization) counters.wrongCredentials++; return send(401, {}); }
      const project = { id: 7, name: '订单服务', full_name: 'team/service', default_branch: 'main', clone_url: `${base}/team/service.git`, html_url: `${base}/team/service` };
      if (endpoint === 'user') return send(200, { login: 'fixture-github-bot' });
      if (endpoint === 'user/repos') return send(200, [project]);
      if (endpoint === 'repos/team/service') return send(200, project);
      if (endpoint === 'repos/team/service/branches') return url.searchParams.get('page') === '2' ? send(200, [{ name: 'release' }]) : send(200, [{ name: 'main' }], { Link: `<${base}/api/v3/repos/team/service/branches?page=2>; rel="next"` });
      return send(404, {});
    }
    if (url.pathname.startsWith('/api/v4/')) {
      counters.api++;
      if (request.headers['private-token'] !== token) { counters.invalidAuth++; return send(401, { message: 'Unauthorized' }); }
      const endpoint = decodeURIComponent(url.pathname.slice('/api/v4/'.length));
      const project = { id: 7, name: '订单服务', path_with_namespace: 'team/service', default_branch: 'main', http_url_to_repo: `${base}/team/service.git`, web_url: `${base}/team/service` };
      const privateProject = { id: 8, name: '隔离测试仓库', path_with_namespace: 'team/private', default_branch: 'main', http_url_to_repo: `${base}/team/private.git`, web_url: `${base}/team/private` };
      if (endpoint === 'user') return send(200, { username: 'fixture-bot' });
      if (endpoint === 'groups/team') return send(200, { id: 1, full_path: 'team' });
      if (endpoint === 'projects' || endpoint === 'groups/team/projects') return send(200, multiProject ? [project, privateProject] : [project]);
      if (endpoint === 'projects/7' || endpoint === 'projects/team/service') return send(200, project);
      if (multiProject && (endpoint === 'projects/8' || endpoint === 'projects/team/private')) return send(200, privateProject);
      if (endpoint === 'projects/7/repository/branches') return send(200, [{ name: 'main', default: true }, { name: 'release', default: false }]);
      if (multiProject && endpoint === 'projects/8/repository/branches') return send(200, [{ name: 'main', default: true }]);
      return send(404, { message: 'Not found' });
    }
    counters.clone++;
    if (rejectClone || (!anonymous && request.headers.authorization !== `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`)) {
      if (request.headers.authorization) counters.wrongCredentials++;
      counters.invalidAuth++; response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitLab fixture"' }); response.end('Unauthorized'); return;
    }
    const child = spawn('git', ['http-backend'], { env: { ...process.env, GIT_PROJECT_ROOT: remoteRoot, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers['content-type'] || '', CONTENT_LENGTH: request.headers['content-length'] || '', REMOTE_USER: 'fixture', HTTP_GIT_PROTOCOL: request.headers['git-protocol'] || '' } });
    let header = Buffer.alloc(0); let sent = false;
    child.stdout.on('data', bytes => {
      if (sent) return response.write(bytes);
      header = Buffer.concat([header, bytes]); let cut = header.indexOf('\r\n\r\n'); let skip = 4;
      if (cut < 0) { cut = header.indexOf('\n\n'); skip = 2; }
      if (cut < 0) return;
      const lines = header.subarray(0, cut).toString().split(/\r?\n/); const headers = {}; let status = 200;
      for (const line of lines) { const colon = line.indexOf(':'); if (colon < 0) continue; const key = line.slice(0, colon); const value = line.slice(colon + 1).trim(); if (key.toLowerCase() === 'status') status = Number(value.split(' ')[0]); else headers[key] = value; }
      response.writeHead(status, headers); response.write(header.subarray(cut + skip)); sent = true;
    });
    child.on('error', error => { response.writeHead(500); response.end(error.message); });
    child.stderr.resume(); child.stdout.on('end', () => response.end()); request.pipe(child.stdin);
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  return { root, source, remote, token, username, provider, counters, baseUrl: `http://${publicHost}:${server.address().port}`,
    rejectClones(value) { rejectClone = value; },
    async update(version) { await fs.writeFile(path.join(source, 'src/pricing.ts'), `export function normalizePrice(value: number): number { return Math.max(0, value); }\nexport function calculatePrice(value: number): number { return normalizePrice(value) * 0.${10-version}; } // fixture-v${version}\n`); await git(['add', '.']); await git(['commit', '-m', `fixture-v${version}`]); await git(['push', 'origin', 'main']); return await git(['rev-parse', 'HEAD']); },
    async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); },
  };
}
