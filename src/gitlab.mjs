import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { normalizedBaseUrl, sameGitlabRepository } from './security.mjs';

export function connectionInput(input, existing) {
  const baseUrl = normalizedBaseUrl(input.baseUrl);
  const supplied = typeof input.token === 'string' ? input.token.trim() : '';
  if (!supplied && existing && existing.baseUrl !== baseUrl) throw new Error('更换 GitLab 地址时请填写新凭据');
  const token = supplied || existing?.token;
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('请填写有效的 GitLab Access Token');
  const username = String(input.username || 'oauth2').trim();
  if (!username || username.length > 200 || /[\r\n]/.test(username)) throw new Error('Git 用户名格式错误');
  const group = String(input.group || '').trim();
  if (group.length > 300 || /[?#\r\n]/.test(group)) throw new Error('GitLab 组路径格式错误');
  const caPem = String(input.caPem || '').trim();
  if (caPem.length > 64000) throw new Error('CA 证书过长');
  if (caPem) {
    const certs = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certs?.length) throw new Error('请填写 PEM 格式的 CA 证书');
    for (const cert of certs) new X509Certificate(cert);
  }
  return { baseUrl, token, username, group, caPem };
}
export async function apiGet(c, endpoint, query = {}) {
  const url = new URL(`${c.baseUrl}/api/v4/${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', headers: { 'PRIVATE-TOKEN': c.token, Accept: 'application/json' },
      ...(c.caPem && url.protocol === 'https:' ? { ca: c.caPem } : {}),
    }, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 8_000_000) request.destroy(new Error('GitLab 响应超过限制')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const help = response.statusCode === 401 ? '检查 Token 是否有效' : response.statusCode === 403 ? '检查 read_api 权限和项目访问权' : response.statusCode === 404 ? '检查项目或组路径及访问权限' : '检查 GitLab 服务状态';
          return reject(new Error(`GitLab HTTP ${response.statusCode}：${help}`));
        }
        try { resolve({ data: JSON.parse(Buffer.concat(chunks).toString('utf8')), next: response.headers['x-next-page'] || '' }); }
        catch { reject(new Error('GitLab 未返回 JSON，请检查服务地址是否包含正确的子路径')); }
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('GitLab 请求超时')));
    request.on('error', reject); request.end();
  });
}
export async function paginated(c, endpoint, query = {}) {
  const result = []; let page = '1';
  for (let count = 0; count < 100; count++) {
    const response = await apiGet(c, endpoint, { ...query, per_page: 100, page });
    if (!Array.isArray(response.data)) throw new Error('GitLab 列表响应格式错误');
    result.push(...response.data);
    if (!response.next) return result;
    if (!/^\d+$/.test(String(response.next)) || Number(response.next) <= Number(page)) throw new Error('GitLab 分页信息无效');
    page = response.next;
  }
  throw new Error('项目数量超过本次发现上限，请缩小 GitLab 组范围');
}
export function projectView(p, baseUrl) {
  const id = Number(p.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof p.path_with_namespace !== 'string') throw new Error('GitLab 项目信息无效');
  return { projectId: id, name: String(p.name || p.path_with_namespace), path: p.path_with_namespace,
    defaultBranch: p.default_branch || 'main', remoteUrl: sameGitlabRepository(p.http_url_to_repo, baseUrl), webUrl: p.web_url || '' };
}
export async function projects(c, search = '') {
  const endpoint = c.group ? `groups/${encodeURIComponent(c.group)}/projects` : 'projects';
  const query = c.group ? { include_subgroups: true, with_shared: false, archived: false } : { membership: true, archived: false };
  const rows = await paginated(c, endpoint, { ...query, ...(search ? { search } : {}) });
  return rows.map(p => projectView(p, c.baseUrl)).sort((a, b) => a.path.localeCompare(b.path));
}
export async function project(c, idOrPath) {
  if (typeof idOrPath === 'string' && /^https?:\/\//i.test(idOrPath)) {
    const value = sameGitlabRepository(idOrPath, c.baseUrl);
    idOrPath = decodeURIComponent(new URL(value).pathname.slice(new URL(`${c.baseUrl}/`).pathname.length)).replace(/\.git$/i, '').replace(/\/$/, '');
  } else if (typeof idOrPath === 'string' && idOrPath.startsWith('git@')) {
    const match = /^git@([^:]+):(.+)$/.exec(idOrPath);
    if (!match || match[1].toLowerCase() !== new URL(c.baseUrl).hostname.toLowerCase()) throw new Error('SSH 仓库地址必须属于配置的 GitLab');
    idOrPath = match[2].replace(/\.git$/i, '');
  }
  return projectView((await apiGet(c, `projects/${encodeURIComponent(idOrPath)}`)).data, c.baseUrl);
}
export async function branches(c, id) {
  const rows = await paginated(c, `projects/${encodeURIComponent(id)}/repository/branches`);
  return rows.map(b => ({ name: b.name, default: Boolean(b.default) }));
}
