const { t, tr, text: writeText, date: formatDate, list: formatList } = globalThis.RepoHarborI18n;
const $ = id => document.getElementById(id);
let state = null, page = 'repos', detailId = null, token = null, toastTimer, lastRows = '';
let selectedTokenId = null, editingTokenId = null, tokenScopeSelection = new Set(), lastTokenRows = '';
const labels = { ready: '已发布', queued: '等待同步', fetching: '拉取代码', indexing: '建立地图', restoring: '恢复查询', error: '同步失败', paused: '已暂停' };
const escape = text => String(text ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const time = formatDate;
function buildText(repo) {
  const b = repo.build; if (!b) return '';
  const phases = { starting: '启动解析器', discovery: '扫描文件', indexing: '文件索引', symbols: '符号关系', viewer: '生成查看地图', ready: '地图就绪', validating: '验证地图', failed: '建图失败' };
  const seconds = Math.max(0, Math.floor(((b.finishedAt ? Date.parse(b.finishedAt) : ['indexing', 'restoring'].includes(repo.status) ? Date.now() : Date.parse(b.updatedAt || b.startedAt)) - Date.parse(b.startedAt)) / 1000));
  const count = b.phase === 'indexing' && b.total > 0 ? tr` ${b.current || 0} / ${b.total} 文件（${Math.floor((b.current || 0) / b.total * 100)}%）` : '';
  return tr`${t(phases[b.phase] || '建立地图')}${count} · 已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · 上限 ${b.timeoutMinutes} 分钟`;
}
function toast(message, error = false) { writeText($('toast'), () => message); $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function api(url, options = {}) {
  const response = await fetch(`/api/${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const value = await response.json();
  if (!response.ok) { if (response.status === 401 && url !== 'login' && url !== 'password') showLogin(); throw new Error(value.error || tr`请求失败（${response.status}）`); }
  return value;
}
function showLogin() {
  RepoHarborI18n.clear(document.body);
  renderClientConfig();
  $('app').hidden = true; $('login-screen').hidden = false; state = null; token = null;
  $('login-password').value = ''; $('connection-form').reset(); $('password-form').reset();
  $('mcp-token').value = t('点击查看令牌'); $('mcp-token').type = 'password'; writeText($('show-token'), () => '查看');
  editingConnectionId = null; lastConnections = ''; $('connection-list').replaceChildren(); $('repo-connection').replaceChildren();
  $('repo-rows').replaceChildren(); $('detail-events').replaceChildren(); lastRows = '';
  selectedTokenId = null; editingTokenId = null; tokenScopeSelection.clear(); lastTokenRows = ''; $('access-token-list').replaceChildren(); $('access-token-repositories').replaceChildren(); $('access-token-form').reset(); writeText($('access-token-count'), () => ''); writeText($('access-token-selected-name'), () => ''); writeText($('access-token-selected-scope'), () => ''); $('access-token-selected').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
async function busy(form, fn) { const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); try { await fn(); } finally { buttons.forEach(b => b.disabled = false); } }
function navigate(next) { page = next; for (const section of ['repos', 'connection', 'ai', 'settings']) $('page-' + section).hidden = next !== section; document.querySelectorAll('nav [data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === next); button.setAttribute('aria-current', button.dataset.page === next ? 'page' : 'false'); }); const name = { repos: '仓库', connection: '代码源', ai: 'AI 接入', settings: '管理设置' }; writeText($('breadcrumb'), () => tr`工作区 / ${t(name[next])}`); }
function render({ preserveInputs = false } = {}) {
  if (!state) return;
  const rows = state.repositories; const ready = rows.filter(r => r.current && r.enabled).length;
  writeText($('repo-summary'), () => rows.length ? tr`${rows.length} 个仓库，${ready} 个已发布` : '暂无仓库');
  $('connection-notice').hidden = Boolean(state.connections.length); $('repo-empty').hidden = rows.length > 0; $('repo-table-wrap').hidden = rows.length === 0;
  $('sync-all').disabled = !rows.some(r => r.enabled); writeText($('connection-indicator'), () => state.connections.length ? tr`已配置 ${state.connections.length} 个代码源` : '尚未配置代码源'); $('connection-indicator').classList.toggle('connected', Boolean(state.connections.length));
  writeText($('task-indicator'), () => state.task ? tr`正在同步，另有 ${state.queued} 个等待` : state.queued ? tr`${state.queued} 个任务等待同步` : '自动同步已就绪');
  const html = rows.map(r => `<tr><td><button class="repo-name" data-detail="${r.id}">${escape(r.name)}</button><div class="repo-path">${escape(r.path)}</div><small class="source-label">${escape(r.source?.name || '')}</small><span class="branch-tag">${escape(r.branch)}</span></td><td><span class="pill ${escape(r.status)}">${t(labels[r.status] || '等待同步')}</span><span class="status-sub">${escape(t(r.current && r.status === 'error' ? '仍可读取上次发布版本' : r.stage))}</span></td><td data-published-label="${t('已发布版本')}"><span class="commit">${r.current ? escape(r.current.commit.slice(0, 12)) : t('尚未发布')}${r.current?.branch !== r.branch && r.current ? `<small>${escape(tr`当前：${r.current.branch}`)}</small>` : ''}</span></td><td data-sync-label="${t('最近成功同步')}">${time(r.lastSuccess)}</td><td class="right"><div class="row-actions"><button class="text-button" data-sync="${r.id}" ${r.enabled ? '' : 'disabled'}>${t('同步')}</button><button class="text-button" data-detail="${r.id}">${t('详情')}</button></div></td></tr>`).join('');
  if (html !== lastRows) { $('repo-rows').innerHTML = html; lastRows = html; }
  renderConnections();
  if (!preserveInputs && document.activeElement !== $('interval')) $('interval').value = state.intervalMinutes;
  if (!preserveInputs && document.activeElement !== $('build-timeout')) $('build-timeout').value = state.buildTimeoutMinutes;
  renderDetail();
  renderAccessTokens();
}
async function refresh() { state = await api('state'); render(); }
async function showApp() { $('login-screen').hidden = true; $('app').hidden = false; await refresh(); navigate(page); }
async function copy(text) { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.className = 'clipboard-buffer'; area.value = text; document.body.append(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('浏览器不允许复制，请手工选择内容'); } toast('已复制'); }
function confirm(title, message, button = '确认') { return new Promise(resolve => { writeText($('confirm-title'), () => title); writeText($('confirm-message'), () => message); writeText($('confirm-ok'), () => button); const dialog = $('confirm-dialog'); const finish = value => { dialog.close(); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; dialog.oncancel = null; resolve(value); }; $('confirm-ok').onclick = () => finish(true); $('confirm-cancel').onclick = () => finish(false); dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.showModal(); }); }
const sourceLabels = { gitlab: 'GitLab', github: 'GitHub', git: '通用 Git' };
let editingConnectionId = null, lastConnections = '';
const repositoryLabel = repo => repo ? `${repo.source?.name ? repo.source.name + ' / ' : ''}${repo.path}` : t('已移除仓库');
function renderConnections() {
  const entries = state.connections || [];
  $('connection-empty').hidden = entries.length > 0; $('connection-list').hidden = !entries.length; $('create-connection').disabled = entries.length >= 32;
  const signature = JSON.stringify([RepoHarborI18n.language, entries, state.repositories.map(r => [r.id, r.connectionId])]);
  if (signature === lastConnections) return;
  $('connection-list').innerHTML = entries.map(c => {
    const count = state.repositories.filter(r => r.connectionId === c.id).length;
    return `<li class="connection-row"><div><strong>${escape(c.name)}</strong><span class="branch-tag">${t(sourceLabels[c.type])}</span></div><p>${escape(c.baseUrl)}</p><small>${escape(tr`${count} 个仓库 · ${t(c.anonymous ? '无需认证' : '已保存读取凭据')}`)}</small><div class="row-actions"><button class="text-button" data-connection-action="edit" data-connection-id="${c.id}">${t('编辑连接')}</button><button class="text-button danger" data-connection-action="delete" data-connection-id="${c.id}" ${count ? `disabled title="${t('请先移除该连接的仓库配置')}"` : ''}>${t('移除连接')}</button></div></li>`;
  }).join(''); lastConnections = signature;
}
function connectionFields(reset = false) {
  const type = $('connection-type').value, c = state.connections.find(c => c.id === editingConnectionId);
  if (reset) { $('connection-anonymous').checked = false; $('gitlab-username').value = type === 'gitlab' ? 'oauth2' : type === 'github' ? 'x-access-token' : 'git'; $('gitlab-token').value = ''; if (!c) $('gitlab-url').value = type === 'github' ? 'https://github.com' : ''; }
  if (type === 'gitlab') $('connection-anonymous').checked = false;
  const anonymous = $('connection-anonymous').checked;
  $('source-anonymous-option').hidden = type === 'gitlab'; $('source-auth-fields').hidden = anonymous;
  $('gitlab-token').required = !anonymous && !(c?.hasToken && c.type === type && c.baseUrl === $('gitlab-url').value.replace(/\/+$/, ''));
  $('gitlab-url').placeholder = type === 'github' ? 'https://github.com' : 'https://git.example.internal';
  writeText($('source-url-note'), () => type === 'github' ? '填写 github.com 或 GitHub Enterprise Server 首页；不填写 api.github.com。' : '填写仓库所在服务首页，可包含路径前缀。仓库地址必须属于该连接。');
  const permission = type === 'gitlab' ? '需要 read_api、read_repository 和项目读取权限。' : type === 'github' ? '个人访问令牌需允许所选仓库的 Contents 读取；组织可能需要批准或 SSO 授权。' : '私有仓库填写实际 Git 用户名与密码 / Token；添加仓库时验证读取权限。';
  writeText($('token-note'), () => anonymous ? '仅访问无需认证的公开仓库。' : `${c?.hasToken ? t('留空保留当前凭据。') : ''}${t(permission)}`);
  $('test-connection').hidden = type === 'git';
  if (type === 'git') writeText($('connection-result'), () => '通用 Git 在添加具体仓库时通过实际 Git 握手验证。');
  else if (reset) writeText($('connection-result'), () => '');
}
function openConnection(id) {
  const c = state.connections.find(c => c.id === id);
  editingConnectionId = c?.id || null; $('connection-form').reset(); writeText($('connection-error'), () => ''); writeText($('connection-result'), () => '');
  writeText($('connection-dialog-title'), () => c ? '编辑代码源连接' : '添加连接');
  $('connection-name').value = c?.name || ''; $('connection-type').value = c?.type || 'gitlab';
  $('gitlab-url').value = c?.baseUrl || ''; $('gitlab-username').value = c?.username || 'oauth2'; $('gitlab-ca').value = c?.caPem || ''; $('connection-anonymous').checked = c?.anonymous || false;
  const bound = Boolean(c && state.repositories.some(r => r.connectionId === c.id));
  $('connection-type').disabled = bound; $('gitlab-url').readOnly = bound; $('source-identity-note').hidden = !bound;
  connectionFields(); $('connection-dialog').showModal(); $('connection-name').focus();
}
function connectionBody() { const c = state.connections.find(c => c.id === editingConnectionId); return { ...(c ? { id: c.id } : {}), type: $('connection-type').value, name: $('connection-name').value, baseUrl: $('gitlab-url').value, username: $('gitlab-username').value, token: $('gitlab-token').value, anonymous: $('connection-anonymous').checked, caPem: $('gitlab-ca').value, group: c?.group || '' }; }
async function connectionAction(action, id) {
  const c = state.connections.find(c => c.id === id); if (!c) return;
  if (action === 'edit') return openConnection(id);
  if (!await confirm('移除代码源连接', `移除 ${c.name} 的连接与读取凭据。已下载的快照不会删除。`, '移除连接')) return;
  await api(`connections/${id}`, { method: 'DELETE', body: {} }); await refresh(); toast('连接已移除');
}
function repositoryHint() {
  const c = state.connections.find(c => c.id === $('repo-connection').value);
  $('repo-url').placeholder = c ? `${c.baseUrl}/team/service.git` : t('请选择代码源连接');
  writeText($('repo-url-note'), () => c?.type === 'git' ? '填写完整 HTTP(S) 仓库地址；读取权限将在添加时验证。' : '支持完整仓库地址、owner/repository 或 git@host:path.git；实际使用 HTTP(S) 同步。');
}
function openAdd() {
  if (!state?.connections.length) { navigate('connection'); toast('请先添加代码源连接'); return; }
  $('add-form').reset(); writeText($('add-error'), () => '');
  $('repo-connection').innerHTML = (state.connections.length > 1 ? `<option value="">${t('请选择连接')}</option>` : '') + state.connections.map(c => `<option value="${c.id}">${escape(c.name)} · ${t(sourceLabels[c.type])}</option>`).join('');
  repositoryHint(); $('add-dialog').showModal(); (state.connections.length > 1 ? $('repo-connection') : $('repo-url')).focus();
}
async function openDetail(id) {
  detailId = id; const repo = state.repositories.find(r => r.id === id); if (!repo) return;
  $('detail-name').textContent = repo.name; $('detail-path').textContent = repositoryLabel(repo);
  $('branch-select').innerHTML = `<option>${escape(repo.branch)}</option>`; $('detail-dialog').showModal(); renderDetail();
  try { const result = await api(`branches?repoId=${repo.id}`); if (detailId !== id) return; const names = [...new Set([repo.branch, ...result.branches.map(b => b.name)])]; $('branch-select').innerHTML = names.map(name => `<option value="${escape(name)}" ${name === repo.branch ? 'selected' : ''}>${escape(name)}</option>`).join(''); }
  catch (e) { toast(e.message, true); }
}
function renderDetail() {
  if (!detailId || !$('detail-dialog').open) return; const r = state.repositories.find(repo => repo.id === detailId);
  if (!r) { $('detail-dialog').close(); detailId = null; return; }
  writeText($('detail-status'), () => labels[r.status] || r.status); $('detail-status').className = `pill ${r.status}`; writeText($('detail-stage'), () => r.stage);
  $('build-progress').hidden = !r.build; writeText($('build-progress-text'), () => buildText(r));
  const counted = r.status === 'indexing' && r.build?.phase === 'indexing' && r.build.total > 0;
  $('build-meter').hidden = !counted; if (counted) { $('build-meter').max = r.build.total; $('build-meter').value = r.build.current || 0; }
  writeText($('build-progress-note'), () => r.build?.phase === 'symbols' ? '文件索引已完成，正在分析符号与调用关系。该阶段不提供文件百分比。' : '百分比仅表示文件索引进度；完整符号关系和地图验证完成后才发布。');
  writeText($('detail-commit'), () => r.current ? `${r.current.branch} @ ${r.current.commit}` : '尚未发布'); writeText($('detail-published'), () => time(r.current?.indexedAt)); writeText($('detail-next'), () => r.enabled ? time(r.nextRun) : '已暂停');
  $('detail-sync').disabled = !r.enabled; writeText($('detail-toggle'), () => r.enabled ? '暂停同步' : '启用并同步');
  $('detail-map').disabled = !r.enabled || !r.current; $('detail-map').title = t(r.current ? '查看当前发布版本的地图与源码' : '首次建图成功后可查看');
  $('detail-events').innerHTML = [...r.events].reverse().map(event => `<li class="${escape(event.kind)}"><time>${time(event.time)}</time>${escape(t(event.message))}</li>`).join('') || `<li>${t('等待首次同步。')}</li>`;
}
async function syncRepo(id) { const result = await api('sync', { method: 'POST', body: id ? { id } : {} }); toast(result.queued ? tr`已安排 ${result.queued} 个同步任务` : '所选仓库正在同步或已有任务等待'); await refresh(); }
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.page) navigate(button.dataset.page);
  if (button.dataset.close) $(button.dataset.close).close();
  if (button.dataset.detail) void openDetail(button.dataset.detail);
  if (button.dataset.sync) void syncRepo(button.dataset.sync).catch(e => toast(e.message, true));
  if (button.dataset.connectionAction) void connectionAction(button.dataset.connectionAction, button.dataset.connectionId).catch(e => toast(e.message, true));
  if (button.dataset.accessAction) void accessTokenAction(button.dataset.accessAction, button.dataset.tokenId).catch(e => toast(e.message, true));
});
$('login-form').addEventListener('submit', event => { event.preventDefault(); writeText($('login-error'), () => ''); void busy($('login-form'), async () => { await api('login', { method: 'POST', body: { password: $('login-password').value } }); await showApp(); }).catch(e => writeText($('login-error'), () => e.message)); });
$('logout').onclick = () => void api('logout', { method: 'POST', body: {} }).then(showLogin).catch(e => toast(e.message, true));
$('add-repo').onclick = openAdd; $('empty-add').onclick = openAdd;
$('sync-all').onclick = () => void syncRepo().catch(e => toast(e.message, true));
$('create-connection').onclick = () => openConnection(); $('empty-connection').onclick = () => openConnection();
$('connection-type').onchange = () => connectionFields(true); $('connection-anonymous').onchange = () => connectionFields(); $('gitlab-url').oninput = () => connectionFields();
$('repo-connection').onchange = repositoryHint;
$('connection-dialog').addEventListener('close', () => { $('gitlab-token').value = ''; editingConnectionId = null; });
$('connection-form').addEventListener('submit', event => {
  event.preventDefault(); writeText($('connection-error'), () => '');
  const id = editingConnectionId; const body = connectionBody();
  void busy($('connection-form'), async () => { await api(id ? `connections/${id}` : 'connections', { method: id ? 'PATCH' : 'POST', body }); $('connection-dialog').close(); await refresh(); toast('代码源连接已保存'); }).catch(e => { writeText($('connection-result'), () => ''); writeText($('connection-error'), () => e.message); });
});
$('test-connection').onclick = () => void busy($('connection-form'), async () => { writeText($('connection-error'), () => ''); writeText($('connection-result'), () => '正在测试…'); const body = connectionBody(); const result = await api('connections/test', { method: 'POST', body }); writeText($('connection-result'), () => result.verified ? tr`连接成功：${body.anonymous ? t('公开仓库（无需认证）') : result.username}` : result.message); }).catch(e => { writeText($('connection-result'), () => ''); writeText($('connection-error'), () => e.message); });
$('add-form').addEventListener('submit', event => { event.preventDefault(); writeText($('add-error'), () => ''); void busy($('add-form'), async () => { const result = await api('repositories', { method: 'POST', body: { connectionId: $('repo-connection').value, projectPath: $('repo-url').value, branch: $('repo-branch').value.trim() } }); $('add-dialog').close(); await refresh(); toast(result.added.length ? '仓库已添加，开始首次同步' : '此仓库已存在，可在详情中修改分支'); }).catch(e => writeText($('add-error'), () => e.message)); });
$('branch-form').addEventListener('submit', event => { event.preventDefault(); void api(`repositories/${detailId}`, { method: 'PATCH', body: { branch: $('branch-select').value } }).then(refresh).then(() => toast('分支已保存，将同步新版本')).catch(e => toast(e.message, true)); });
$('detail-sync').onclick = () => void syncRepo(detailId).catch(e => toast(e.message, true));
$('detail-map').onclick = () => { const r = state.repositories.find(repo => repo.id === detailId); if (r?.current && r.enabled) window.open(`/map?${new URLSearchParams({ repo: r.id, commit: r.current.commit })}`, '_blank', 'noopener'); };
$('detail-toggle').onclick = () => { const r = state.repositories.find(r => r.id === detailId); void api(`repositories/${detailId}`, { method: 'PATCH', body: { enabled: !r.enabled } }).then(refresh).then(() => toast(r.enabled ? '已暂停同步及 AI 访问' : '已启用仓库')).catch(e => toast(e.message, true)); };
$('detail-remove').onclick = async () => { const r = state.repositories.find(r => r.id === detailId); if (!await confirm('移除仓库配置', `移除 ${r.path} 后，AI 无法继续访问此仓库。已下载的快照和索引会保留。`, '移除配置')) return; try { await api(`repositories/${detailId}`, { method: 'DELETE', body: {} }); $('detail-dialog').close(); await refresh(); toast('仓库配置已移除'); } catch(e) { toast(e.message, true); } };
const mcpUrl = `${location.origin}/mcp`; $('mcp-url').value = mcpUrl;
function renderClientConfig() { writeText($('mcp-config'), () => JSON.stringify({ mcpServers: { 'repo-harbor': { url: mcpUrl, headers: { Authorization: t('Bearer <AI 读取令牌>') } } } }, null, 2)); }
renderClientConfig();
$('copy-mcp-url').onclick = () => void copy(mcpUrl).catch(e => toast(e.message, true));
function resetTokenSecret() { token = null; $('mcp-token').value = t('点击查看令牌'); $('mcp-token').type = 'password'; writeText($('show-token'), () => '查看'); }
function scopeNames(item) { return item.repositoryIds.map(id => repositoryLabel(state.repositories.find(r => r.id === id))); }
function renderAccessTokens() {
  const entries = state.accessTokens || [];
  writeText($('access-token-count'), () => tr`${entries.length} 个令牌`);
  $('create-access-token').disabled = !state.repositories.length || entries.length >= 64;
  $('access-token-empty').hidden = entries.length > 0;
  writeText($('access-token-empty'), () => state.repositories.length ? '还没有读取令牌。创建时选择允许访问的仓库，再配置到 AI 客户端。' : '请先在仓库页添加仓库，再创建读取令牌。');
  const rows = JSON.stringify([RepoHarborI18n.language, entries, state.repositories.map(r => [r.id, r.path, r.enabled, r.source])]);
  if (rows !== lastTokenRows) {
    $('access-token-list').replaceChildren(...entries.map(item => {
      const row = document.createElement('li'); row.className = 'token-row'; row.dataset.tokenId = item.id;
      const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.name;
      const status = document.createElement('span'); status.className = `pill ${item.enabled ? 'ready' : 'paused'}`; writeText(status, () => item.enabled ? '已启用' : '已停用'); heading.append(title, status);
      const scope = document.createElement('p'); scope.className = 'token-row-scope'; writeText(scope, () => formatList(scopeNames(item)) || '没有授权仓库');
      const actions = document.createElement('div'); actions.className = 'token-row-actions';
      for (const [action, label] of [['connect', '接入信息'], ['edit', '编辑权限'], ['toggle', item.enabled ? '停用' : '启用'], ['delete', '删除']]) {
        const b = document.createElement('button'); b.className = `text-button${action === 'delete' ? ' danger' : ''}`; b.dataset.accessAction = action; b.dataset.tokenId = item.id; writeText(b, () => label); b.disabled = action === 'connect' && !item.enabled; actions.append(b);
      }
      row.append(heading, scope, actions); return row;
    })); lastTokenRows = rows;
  }
  const selected = entries.find(t => t.id === selectedTokenId && t.enabled);
  $('access-token-selected').hidden = !selected;
  if (!selected) { selectedTokenId = null; resetTokenSecret(); writeText($('access-token-selected-name'), () => ''); writeText($('access-token-selected-scope'), () => ''); }
  else { writeText($('access-token-selected-name'), () => tr`${selected.name} · 接入信息`); writeText($('access-token-selected-scope'), () => tr`允许仓库：${formatList(scopeNames(selected)) || t('无')}`); }
}
function scopeCount() { writeText($('access-token-scope-count'), () => tr`已选择 ${tokenScopeSelection.size} 个仓库`); $('access-token-save').disabled = !editingTokenId && !tokenScopeSelection.size; }
function renderScopeOptions() {
  const q = $('access-token-search').value.trim().toLowerCase();
  $('access-token-repositories').replaceChildren(...state.repositories.filter(r => repositoryLabel(r).toLowerCase().includes(q) || r.name.toLowerCase().includes(q)).map(repo => {
    const label = document.createElement('label'); label.className = 'token-scope-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = repo.id; input.checked = tokenScopeSelection.has(repo.id);
    input.onchange = () => { input.checked ? tokenScopeSelection.add(repo.id) : tokenScopeSelection.delete(repo.id); scopeCount(); };
    const text = document.createElement('span'); writeText(text, () => `${repositoryLabel(repo)}${repo.enabled ? '' : t('（已暂停）')}`); label.append(input, text); return label;
  })); scopeCount();
}
function openAccessToken(item) {
  resetTokenSecret();
  editingTokenId = item?.id || null; $('access-token-form').reset(); writeText($('access-token-error'), () => '');
  $('access-token-name').value = item?.name || ''; $('access-token-enabled').checked = item?.enabled ?? true;
  tokenScopeSelection = new Set((item?.repositoryIds || []).filter(id => state.repositories.some(r => r.id === id)));
  writeText($('access-token-dialog-title'), () => item ? '编辑读取权限' : '创建读取令牌'); writeText($('access-token-save'), () => item ? '保存权限' : '创建令牌'); $('access-token-edit-note').hidden = !item;
  renderScopeOptions(); $('access-token-dialog').showModal(); $('access-token-name').focus();
}
async function accessTokenAction(action, id) {
  const item = state.accessTokens.find(t => t.id === id); if (!item) return;
  if (action === 'connect') { selectedTokenId = id; resetTokenSecret(); renderAccessTokens(); $('access-token-selected').scrollIntoView({ block: 'nearest' }); return; }
  if (action === 'edit') { openAccessToken(item); return; }
  if (action === 'toggle') { await api(`access-tokens/${id}`, { method: 'PATCH', body: { enabled: !item.enabled } }); await refresh(); toast(item.enabled ? '令牌已停用，已有会话已关闭' : '令牌已启用'); return; }
  if (action === 'delete' && await confirm('删除读取令牌', `删除“${item.name}”后，该客户端不能继续访问地图和源码。仓库配置与数据保留。`, '删除令牌')) { await api(`access-tokens/${id}`, { method: 'DELETE', body: {} }); await refresh(); toast('读取令牌已删除'); }
}
$('create-access-token').onclick = () => openAccessToken(); $('access-token-search').oninput = renderScopeOptions;
$('access-token-form').addEventListener('submit', event => {
  event.preventDefault(); writeText($('access-token-error'), () => '');
  const id = editingTokenId, body = { name: $('access-token-name').value, repositoryIds: [...tokenScopeSelection], enabled: $('access-token-enabled').checked };
  void busy($('access-token-form'), async () => { const result = await api(id ? `access-tokens/${id}` : 'access-tokens', { method: id ? 'PATCH' : 'POST', body }); $('access-token-dialog').close(); selectedTokenId = result.token.id; resetTokenSecret(); await refresh(); toast(id ? '读取权限已保存，该令牌的客户端需重新连接' : '读取令牌已创建，点击查看或复制后配置到客户端'); }).catch(e => writeText($('access-token-error'), () => e.message));
});
async function readToken() {
  const id = selectedTokenId; if (!id) throw new Error('请先选择一个已启用的读取令牌');
  if (!token) { const result = await api(`access-tokens/${id}/secret`); if (selectedTokenId !== id || !state?.accessTokens.some(t => t.id === id && t.enabled)) throw new Error('令牌选择已变化，请重新选择'); token = result.token; }
  $('mcp-token').value = token; return token;
}
$('show-token').onclick = async () => { try { await readToken(); const hidden = $('mcp-token').type === 'password'; $('mcp-token').type = hidden ? 'text' : 'password'; writeText($('show-token'), () => hidden ? '隐藏' : '查看'); } catch(e) { toast(e.message, true); } };
$('copy-token').onclick = () => void readToken().then(copy).catch(e => toast(e.message, true));
$('rotate-token').onclick = async () => { const id = selectedTokenId; if (!id || !await confirm('重新生成读取令牌', '此令牌的旧值会立即失效，对应 AI 会话将关闭。授权仓库保持原选择，其他令牌不受影响。', '重新生成')) return; try { resetTokenSecret(); await api(`access-tokens/${id}/rotate`, { method: 'POST', body: {} }); await refresh(); toast('新令牌已生成，请重新复制并更新该客户端'); } catch(e) { toast(e.message, true); } };
$('schedule-form').addEventListener('submit', event => { event.preventDefault(); void api('schedule', { method: 'PUT', body: { intervalMinutes: Number($('interval').value) } }).then(refresh).then(() => toast('同步间隔已保存')).catch(e => toast(e.message, true)); });
$('build-settings-form').addEventListener('submit', event => { event.preventDefault(); void api('build-settings', { method: 'PUT', body: { timeoutMinutes: Number($('build-timeout').value) } }).then(refresh).then(() => toast('建图超时已保存，下次建图生效')).catch(e => toast(e.message, true)); });
$('password-form').addEventListener('submit', event => { event.preventDefault(); if ($('new-password').value !== $('confirm-password').value) { toast('两次输入的新密码不一致', true); return; } void busy($('password-form'), async () => { await api('password', { method: 'PUT', body: { currentPassword: $('current-password').value, newPassword: $('new-password').value } }); $('password-form').reset(); showLogin(); toast('密码已修改，请重新登录'); }).catch(e => toast(e.message, true)); });
setInterval(() => { if (state && !document.hidden) void refresh().catch(e => toast(e.message, true)); }, 8000);
setInterval(() => { if (state && !document.hidden && $('detail-dialog').open) { const repo = state.repositories.find(r => r.id === detailId); if (repo) writeText($('build-progress-text'), () => buildText(repo)); } }, 1000);

addEventListener('repo-harbor:language', () => {
  if (!token) $('mcp-token').value = t('点击查看令牌');
  if (!state) return;
  render({ preserveInputs: true });
  if ($('connection-dialog').open) connectionFields();
  if ($('add-dialog').open) {
    for (const option of $('repo-connection').options) {
      const c = state.connections.find(c => c.id === option.value);
      option.textContent = c ? `${c.name} · ${t(sourceLabels[c.type])}` : t('请选择连接');
    }
    repositoryHint();
  }
  if ($('access-token-dialog').open) renderScopeOptions();
});
void api('session').then(result => result.authenticated ? showApp() : showLogin()).catch(e => { showLogin(); writeText($('login-error'), () => e.message); });
