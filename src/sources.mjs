import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { connectionInput as gitlabInput, apiGet as gitlabGet, project as gitlabProject, projects as gitlabProjects, branches as gitlabBranches } from './gitlab.mjs';
import { normalizedBaseUrl, sameGitlabRepository, cleanError } from './security.mjs';
import { remoteBranches } from './git.mjs';

export const sourceTypes = { gitlab: 'GitLab', github: 'GitHub', git: '通用 Git' };
export function sourceInput(body, existing) {
  const type = body.type ?? existing?.type ?? 'gitlab';
  if (!Object.hasOwn(sourceTypes, type)) throw new Error('请选择 GitLab、GitHub 或通用 Git');
  const baseUrl = normalizedBaseUrl(body.baseUrl ?? existing?.baseUrl);
  const name = String(body.name ?? existing?.name ?? `${sourceTypes[type]} · ${new URL(baseUrl).host}`).trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('连接名称需为 1–80 个字符');
  const anonymous = body.anonymous ?? existing?.anonymous ?? false;
  if (typeof anonymous !== 'boolean' || (type === 'gitlab' && anonymous)) throw new Error('GitLab 连接需要访问令牌');
  const supplied = typeof body.token === 'string' ? body.token.trim() : '';
  const identityChanged = existing && (existing.type !== type || existing.baseUrl !== baseUrl);
  if (identityChanged && !supplied && !anonymous) throw new Error('更换平台或地址时请填写新凭据');
  const token = anonymous ? '' : supplied || existing?.token || '';
  if ((!token && !anonymous) || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('请填写有效的密码 / Access Token，或选择无需认证');
  const username = String(body.username ?? (identityChanged ? '' : existing?.username) ?? '').trim() || (type === 'gitlab' ? 'oauth2' : type === 'github' ? 'x-access-token' : 'git');
  if (username.length > 200 || /[\r\n\x00]/.test(username)) throw new Error('Git 用户名格式错误');
  const caPem = String(body.caPem ?? existing?.caPem ?? '').trim();
  if (caPem.length > 64000) throw new Error('CA 证书过长');
  if (caPem) {
    const certs = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certs?.length) throw new Error('请填写 PEM 格式的 CA 证书');
    for (const cert of certs) new X509Certificate(cert);
  }
  const group = type === 'gitlab' ? String(body.group ?? existing?.group ?? '').trim() : '';
  const c = { type, name, baseUrl, username, token, anonymous, caPem, group };
  if (type === 'gitlab') gitlabInput(c);
  return c;
}
export const sourceSummary = c => c ? { id: c.id, type: c.type, name: c.name, baseUrl: c.baseUrl } : null;
export const repositoryUrl = (value, c) => sameGitlabRepository(value, c.baseUrl);

function projectPath(c, input) {
  let value = String(input).trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(repositoryUrl(value, c));
    value = decodeURIComponent(url.pathname.slice(new URL(c.baseUrl + '/').pathname.length));
  } else if (value.startsWith('git@')) {
    const match = /^git@([^:]+):(.+)$/.exec(value);
    if (!match || match[1].toLowerCase() !== new URL(c.baseUrl).hostname.toLowerCase()) throw new Error('仓库必须属于所选连接');
    value = match[2];
  }
  value = value.replace(/\/$/, '').replace(/\.git$/i, '');
  if (!value || value.length > 1000 || /[?#\x00-\x20\x7f\\]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('仓库路径格式错误');
  return value;
}
function githubBase(c) { return c.baseUrl === 'https://github.com' ? 'https://api.github.com' : `${c.baseUrl}/api/v3`; }
async function githubGet(c, endpoint, query = {}) {
  const url = new URL(`${githubBase(c)}/${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', headers: {
      Accept: 'application/vnd.github+json', 'User-Agent': 'RepoHarbor', 'X-GitHub-Api-Version': '2022-11-28',
      ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
    }, ...(url.protocol === 'https:' && c.caPem ? { ca: c.caPem } : {}) }, res => {
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > 8_000_000) req.destroy(new Error('GitHub 响应超过限制')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`GitHub HTTP ${res.statusCode}：检查仓库地址、令牌权限、组织授权及 API 速率限制`));
        try { resolve({ data: JSON.parse(Buffer.concat(chunks).toString('utf8')), link: res.headers.link || '' }); }
        catch { reject(new Error('GitHub 未返回 JSON，请检查服务首页地址')); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('GitHub 请求超时')));
    req.on('error', reject); req.end();
  });
}
async function githubPages(c, endpoint, query = {}) {
  const rows = []; let page = 1;
  for (let count = 0; count < 100; count++) {
    const result = await githubGet(c, endpoint, { ...query, per_page: 100, page });
    if (!Array.isArray(result.data)) throw new Error('GitHub 列表响应格式错误');
    rows.push(...result.data);
    const next = /<([^>]+)>;\s*rel="next"/.exec(result.link);
    if (!next) return rows;
    const url = new URL(next[1]); const expected = new URL(`${githubBase(c)}/${endpoint}`);
    const number = url.searchParams.get('page');
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || !/^\d+$/.test(number || '') || Number(number) <= page) throw new Error('GitHub 分页信息无效');
    page = Number(number);
  }
  throw new Error('GitHub 列表超过查询上限，请缩小范围');
}
function githubView(p, c) {
  if (!Number.isSafeInteger(p.id) || p.id < 1 || typeof p.full_name !== 'string' || p.full_name.split('/').length !== 2) throw new Error('GitHub 仓库信息无效');
  return { projectId: p.id, externalId: String(p.id), name: String(p.name || p.full_name), path: projectPath(c, p.full_name), defaultBranch: p.default_branch || null, remoteUrl: repositoryUrl(p.clone_url, c), webUrl: p.html_url || '' };
}

export async function testSource(c) {
  if (c.type === 'gitlab') {
    const { data } = await gitlabGet(c, 'user');
    if (c.group) await gitlabGet(c, `groups/${encodeURIComponent(c.group)}`, { with_projects: false });
    return { verified: true, username: data.username || 'GitLab 用户' };
  }
  if (c.type === 'github') {
    const { data } = await githubGet(c, c.anonymous ? 'rate_limit' : 'user');
    if (c.anonymous ? !data.resources?.core : typeof data.login !== 'string') throw new Error('GitHub 返回的连接信息无效');
    return { verified: true, username: c.anonymous ? '公开仓库（无需认证）' : data.login };
  }
  return { verified: false, message: '通用 Git 会在添加仓库时通过实际 Git 握手验证地址和读取权限' };
}
export async function resolveRepository(c, input) {
  if (c.type === 'gitlab') { const p = await gitlabProject(c, input); return { ...p, externalId: String(p.projectId) }; }
  if (c.type === 'github') {
    const parts = projectPath(c, input).split('/');
    if (parts.length !== 2) throw new Error('GitHub 仓库格式应为 owner/repository');
    return githubView((await githubGet(c, `repos/${parts.map(encodeURIComponent).join('/')}`)).data, c);
  }
  if (!/^https?:\/\//i.test(String(input))) throw new Error('通用 Git 需要完整的 HTTP(S) 仓库地址');
  const remoteUrl = repositoryUrl(String(input).trim(), c);
  const refs = await remoteBranches(c, remoteUrl);
  if (!refs.branches.length) throw new Error('远端仓库暂无可同步的分支');
  return { projectId: null, externalId: projectPath(c, remoteUrl), name: projectPath(c, remoteUrl).split('/').at(-1), path: projectPath(c, remoteUrl), defaultBranch: refs.defaultBranch, remoteUrl, webUrl: '' };
}
export async function sourceBranches(c, repo) {
  if (c.type === 'gitlab') return await gitlabBranches(c, repo.projectId);
  if (c.type === 'github') return (await githubPages(c, `repos/${projectPath(c, repo.path).split('/').map(encodeURIComponent).join('/')}/branches`)).map(b => ({ name: String(b.name), default: b.name === repo.defaultBranch }));
  return (await remoteBranches(c, repositoryUrl(repo.remoteUrl, c))).branches;
}
export async function sourceProjects(c, search) {
  if (c.type === 'gitlab') return (await gitlabProjects(c, search)).map(p => ({ ...p, externalId: String(p.projectId) }));
  if (c.type === 'git' || c.anonymous) throw new Error('请直接填写具体仓库地址');
  return (await githubPages(c, 'user/repos', { affiliation: 'owner,collaborator,organization_member' })).map(p => githubView(p, c)).filter(p => !search || p.path.toLowerCase().includes(search.toLowerCase()));
}
