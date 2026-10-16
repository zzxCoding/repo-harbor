const $ = id => document.getElementById(id);
let state = null, page = 'repos', detailId = null, token = null, toastTimer, connectionFilled = false, lastRows = '';
let selectedTokenId = null, editingTokenId = null, tokenScopeSelection = new Set(), lastTokenRows = '';
const labels = { ready: '已发布', queued: '等待同步', fetching: '拉取代码', indexing: '建立地图', restoring: '恢复查询', error: '同步失败', paused: '已暂停' };
const escape = text => String(text ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function buildText(repo) {
  const b = repo.build; if (!b) return '';
  const phases = { starting: '启动解析器', discovery: '扫描文件', indexing: '文件索引', symbols: '符号关系', viewer: '生成查看地图', ready: '地图就绪', validating: '验证地图', failed: '建图失败' };
  const seconds = Math.max(0, Math.floor(((b.finishedAt ? Date.parse(b.finishedAt) : ['indexing', 'restoring'].includes(repo.status) ? Date.now() : Date.parse(b.updatedAt || b.startedAt)) - Date.parse(b.startedAt)) / 1000));
  const count = b.phase === 'indexing' && b.total > 0 ? ` ${b.current || 0} / ${b.total} 文件（${Math.floor((b.current || 0) / b.total * 100)}%）` : '';
  return `${phases[b.phase] || '建立地图'}${count} · 已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · 上限 ${b.timeoutMinutes} 分钟`;
}
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function api(url, options = {}) {
  const response = await fetch(`/api/${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const value = await response.json();
  if (!response.ok) { if (response.status === 401 && url !== 'login' && url !== 'password') showLogin(); throw new Error(value.error || `请求失败（${response.status}）`); }
  return value;
}
function showLogin() {
  $('app').hidden = true; $('login-screen').hidden = false; state = null; connectionFilled = false; token = null;
  $('login-password').value = ''; $('connection-form').reset(); $('password-form').reset();
  $('mcp-token').value = '点击查看令牌'; $('mcp-token').type = 'password'; $('show-token').textContent = '查看';
  $('repo-rows').replaceChildren(); $('detail-events').replaceChildren(); lastRows = '';
  selectedTokenId = null; editingTokenId = null; tokenScopeSelection.clear(); lastTokenRows = ''; $('access-token-list').replaceChildren(); $('access-token-repositories').replaceChildren(); $('access-token-form').reset(); $('access-token-count').textContent = ''; $('access-token-selected-name').textContent = ''; $('access-token-selected-scope').textContent = ''; $('access-token-selected').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
async function busy(form, fn) { const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); try { await fn(); } finally { buttons.forEach(b => b.disabled = false); } }
function navigate(next) { page = next; for (const section of ['repos', 'connection', 'ai', 'settings']) $('page-' + section).hidden = next !== section; document.querySelectorAll('nav [data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === next); button.setAttribute('aria-current', button.dataset.page === next ? 'page' : 'false'); }); const name = { repos: '仓库', connection: 'GitLab 连接', ai: 'AI 接入', settings: '管理设置' }; $('breadcrumb').textContent = `工作区 / ${name[next]}`; }
function render() {
  if (!state) return;
  const rows = state.repositories; const ready = rows.filter(r => r.current && r.enabled).length;
  $('repo-summary').textContent = rows.length ? `${rows.length} 个仓库，${ready} 个已发布` : '暂无仓库';
  $('connection-notice').hidden = Boolean(state.connection); $('repo-empty').hidden = rows.length > 0; $('repo-table-wrap').hidden = rows.length === 0;
  $('sync-all').disabled = !rows.some(r => r.enabled); $('connection-indicator').textContent = state.connection ? '已配置 GitLab' : '尚未连接 GitLab'; $('connection-indicator').classList.toggle('connected', Boolean(state.connection));
  $('task-indicator').textContent = state.task ? `正在同步，另有 ${state.queued} 个等待` : state.queued ? `${state.queued} 个任务等待同步` : '自动同步已就绪';
  const html = rows.map(r => `<tr><td><button class="repo-name" data-detail="${r.id}">${escape(r.name)}</button><div class="repo-path">${escape(r.path)}</div><span class="branch-tag">${escape(r.branch)}</span></td><td><span class="pill ${escape(r.status)}">${labels[r.status] || '等待同步'}</span><span class="status-sub">${escape(r.current && r.status === 'error' ? '仍可读取上次发布版本' : r.stage)}</span></td><td><span class="commit">${r.current ? escape(r.current.commit.slice(0, 12)) : '尚未发布'}${r.current?.branch !== r.branch && r.current ? `<small>当前：${escape(r.current.branch)}</small>` : ''}</span></td><td>${time(r.lastSuccess)}</td><td class="right"><div class="row-actions"><button class="text-button" data-sync="${r.id}" ${r.enabled ? '' : 'disabled'}>同步</button><button class="text-button" data-detail="${r.id}">详情</button></div></td></tr>`).join('');
  if (html !== lastRows) { $('repo-rows').innerHTML = html; lastRows = html; }
  if (!connectionFilled) {
    if (state.connection) { $('gitlab-url').value = state.connection.baseUrl; $('gitlab-username').value = state.connection.username; $('gitlab-ca').value = state.connection.caPem; $('token-note').textContent = '已保存凭据。留空保留当前 Token。'; }
    connectionFilled = true;
  }
  if (document.activeElement !== $('interval')) $('interval').value = state.intervalMinutes;
  if (document.activeElement !== $('build-timeout')) $('build-timeout').value = state.buildTimeoutMinutes;
  renderDetail();
  renderAccessTokens();
}
async function refresh() { state = await api('state'); render(); }
async function showApp() { $('login-screen').hidden = true; $('app').hidden = false; await refresh(); navigate(page); }
function connectionBody() { return { baseUrl: $('gitlab-url').value, username: $('gitlab-username').value, token: $('gitlab-token').value, caPem: $('gitlab-ca').value, group: state?.connection?.group || '' }; }
async function copy(text) { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.className = 'clipboard-buffer'; area.value = text; document.body.append(area); area.select(); const copied = document.execCommand('copy'); area.remove(); if (!copied) throw new Error('浏览器不允许复制，请手工选择内容'); } toast('已复制'); }
function confirm(title, message, button = '确认') { return new Promise(resolve => { $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-ok').textContent = button; const dialog = $('confirm-dialog'); const finish = value => { dialog.close(); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; dialog.oncancel = null; resolve(value); }; $('confirm-ok').onclick = () => finish(true); $('confirm-cancel').onclick = () => finish(false); dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.showModal(); }); }
function openAdd() { if (!state?.connection) { navigate('connection'); toast('请先保存 GitLab 连接'); return; } $('add-form').reset(); $('add-error').textContent = ''; $('add-dialog').showModal(); $('repo-url').focus(); }
async function openDetail(id) {
  detailId = id; const repo = state.repositories.find(r => r.id === id); if (!repo) return;
  $('detail-name').textContent = repo.name; $('detail-path').textContent = repo.path;
  $('branch-select').innerHTML = `<option>${escape(repo.branch)}</option>`; $('detail-dialog').showModal(); renderDetail();
  try { const result = await api(`branches?projectId=${repo.projectId}`); if (detailId !== id) return; const names = [...new Set([repo.branch, ...result.branches.map(b => b.name)])]; $('branch-select').innerHTML = names.map(name => `<option value="${escape(name)}" ${name === repo.branch ? 'selected' : ''}>${escape(name)}</option>`).join(''); }
  catch (e) { toast(e.message, true); }
}
function renderDetail() {
  if (!detailId || !$('detail-dialog').open) return; const r = state.repositories.find(repo => repo.id === detailId);
  if (!r) { $('detail-dialog').close(); detailId = null; return; }
  $('detail-status').textContent = labels[r.status] || r.status; $('detail-status').className = `pill ${r.status}`; $('detail-stage').textContent = r.stage;
  $('build-progress').hidden = !r.build; $('build-progress-text').textContent = buildText(r);
  const counted = r.status === 'indexing' && r.build?.phase === 'indexing' && r.build.total > 0;
  $('build-meter').hidden = !counted; if (counted) { $('build-meter').max = r.build.total; $('build-meter').value = r.build.current || 0; }
  $('build-progress-note').textContent = r.build?.phase === 'symbols' ? '文件索引已完成，正在分析符号与调用关系。该阶段不提供文件百分比。' : '百分比仅表示文件索引进度；完整符号关系和地图验证完成后才发布。';
  $('detail-commit').textContent = r.current ? `${r.current.branch} @ ${r.current.commit}` : '尚未发布'; $('detail-published').textContent = time(r.current?.indexedAt); $('detail-next').textContent = r.enabled ? time(r.nextRun) : '已暂停';
  $('detail-sync').disabled = !r.enabled; $('detail-toggle').textContent = r.enabled ? '暂停同步' : '启用并同步';
  $('detail-map').disabled = !r.enabled || !r.current; $('detail-map').title = r.current ? '查看当前发布版本的地图与源码' : '首次建图成功后可查看';
  $('detail-events').innerHTML = [...r.events].reverse().map(event => `<li class="${escape(event.kind)}"><time>${time(event.time)}</time>${escape(event.message)}</li>`).join('') || '<li>等待首次同步。</li>';
}
async function syncRepo(id) { const result = await api('sync', { method: 'POST', body: id ? { id } : {} }); toast(result.queued ? `已安排 ${result.queued} 个同步任务` : '所选仓库正在同步或已有任务等待'); await refresh(); }
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.page) navigate(button.dataset.page);
  if (button.dataset.close) $(button.dataset.close).close();
  if (button.dataset.detail) void openDetail(button.dataset.detail);
  if (button.dataset.sync) void syncRepo(button.dataset.sync).catch(e => toast(e.message, true));
  if (button.dataset.accessAction) void accessTokenAction(button.dataset.accessAction, button.dataset.tokenId).catch(e => toast(e.message, true));
});
$('login-form').addEventListener('submit', event => { event.preventDefault(); $('login-error').textContent = ''; void busy($('login-form'), async () => { await api('login', { method: 'POST', body: { password: $('login-password').value } }); await showApp(); }).catch(e => $('login-error').textContent = e.message); });
$('logout').onclick = () => void api('logout', { method: 'POST', body: {} }).then(showLogin).catch(e => toast(e.message, true));
$('add-repo').onclick = openAdd; $('empty-add').onclick = openAdd;
$('sync-all').onclick = () => void syncRepo().catch(e => toast(e.message, true));
$('connection-form').addEventListener('submit', event => { event.preventDefault(); void busy($('connection-form'), async () => { await api('connection', { method: 'PUT', body: connectionBody() }); $('gitlab-token').value = ''; connectionFilled = false; await refresh(); $('connection-result').textContent = '连接已保存'; toast('GitLab 连接已保存'); navigate('repos'); }).catch(e => { $('connection-result').textContent = ''; toast(e.message, true); }); });
$('test-connection').onclick = () => void busy($('connection-form'), async () => { $('connection-result').textContent = '正在测试…'; const result = await api('connection/test', { method: 'POST', body: connectionBody() }); $('connection-result').textContent = `连接成功：${result.username}`; }).catch(e => { $('connection-result').textContent = ''; toast(e.message, true); });
$('add-form').addEventListener('submit', event => { event.preventDefault(); $('add-error').textContent = ''; void busy($('add-form'), async () => { const result = await api('repositories', { method: 'POST', body: { projectPath: $('repo-url').value, branch: $('repo-branch').value.trim() } }); $('add-dialog').close(); await refresh(); toast(result.added.length ? '仓库已添加，开始首次同步' : '此仓库已存在，可在详情中修改分支'); }).catch(e => $('add-error').textContent = e.message); });
$('branch-form').addEventListener('submit', event => { event.preventDefault(); void api(`repositories/${detailId}`, { method: 'PATCH', body: { branch: $('branch-select').value } }).then(refresh).then(() => toast('分支已保存，将同步新版本')).catch(e => toast(e.message, true)); });
$('detail-sync').onclick = () => void syncRepo(detailId).catch(e => toast(e.message, true));
$('detail-map').onclick = () => { const r = state.repositories.find(repo => repo.id === detailId); if (r?.current && r.enabled) window.open(`/map?${new URLSearchParams({ repo: r.id, commit: r.current.commit })}`, '_blank', 'noopener'); };
$('detail-toggle').onclick = () => { const r = state.repositories.find(r => r.id === detailId); void api(`repositories/${detailId}`, { method: 'PATCH', body: { enabled: !r.enabled } }).then(refresh).then(() => toast(r.enabled ? '已暂停同步及 AI 访问' : '已启用仓库')).catch(e => toast(e.message, true)); };
$('detail-remove').onclick = async () => { const r = state.repositories.find(r => r.id === detailId); if (!await confirm('移除仓库配置', `移除 ${r.path} 后，AI 无法继续访问此仓库。已下载的快照和索引会保留。`, '移除配置')) return; try { await api(`repositories/${detailId}`, { method: 'DELETE', body: {} }); $('detail-dialog').close(); await refresh(); toast('仓库配置已移除'); } catch(e) { toast(e.message, true); } };
const mcpUrl = `${location.origin}/mcp`; $('mcp-url').value = mcpUrl; $('mcp-config').textContent = JSON.stringify({ mcpServers: { 'repo-harbor': { url: mcpUrl, headers: { Authorization: 'Bearer <AI 读取令牌>' } } } }, null, 2);
$('copy-mcp-url').onclick = () => void copy(mcpUrl).catch(e => toast(e.message, true));
function resetTokenSecret() { token = null; $('mcp-token').value = '点击查看令牌'; $('mcp-token').type = 'password'; $('show-token').textContent = '查看'; }
function scopeNames(item) { return item.repositoryIds.map(id => state.repositories.find(r => r.id === id)?.path || '已移除仓库'); }
function renderAccessTokens() {
  const entries = state.accessTokens || [];
  $('access-token-count').textContent = `${entries.length} 个令牌`;
  $('create-access-token').disabled = !state.repositories.length || entries.length >= 64;
  $('access-token-empty').hidden = entries.length > 0;
  $('access-token-empty').textContent = state.repositories.length ? '还没有读取令牌。创建时选择允许访问的仓库，再配置到 AI 客户端。' : '请先在仓库页添加仓库，再创建读取令牌。';
  const rows = JSON.stringify([entries, state.repositories.map(r => [r.id, r.path, r.enabled])]);
  if (rows !== lastTokenRows) {
    $('access-token-list').replaceChildren(...entries.map(item => {
      const row = document.createElement('li'); row.className = 'token-row'; row.dataset.tokenId = item.id;
      const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.name;
      const status = document.createElement('span'); status.className = `pill ${item.enabled ? 'ready' : 'paused'}`; status.textContent = item.enabled ? '已启用' : '已停用'; heading.append(title, status);
      const scope = document.createElement('p'); scope.className = 'token-row-scope'; scope.textContent = scopeNames(item).join('，') || '没有授权仓库';
      const actions = document.createElement('div'); actions.className = 'token-row-actions';
      for (const [action, label] of [['connect', '接入信息'], ['edit', '编辑权限'], ['toggle', item.enabled ? '停用' : '启用'], ['delete', '删除']]) {
        const b = document.createElement('button'); b.className = `text-button${action === 'delete' ? ' danger' : ''}`; b.dataset.accessAction = action; b.dataset.tokenId = item.id; b.textContent = label; b.disabled = action === 'connect' && !item.enabled; actions.append(b);
      }
      row.append(heading, scope, actions); return row;
    })); lastTokenRows = rows;
  }
  const selected = entries.find(t => t.id === selectedTokenId && t.enabled);
  $('access-token-selected').hidden = !selected;
  if (!selected) { selectedTokenId = null; resetTokenSecret(); $('access-token-selected-name').textContent = ''; $('access-token-selected-scope').textContent = ''; }
  else { $('access-token-selected-name').textContent = `${selected.name} · 接入信息`; $('access-token-selected-scope').textContent = `允许仓库：${scopeNames(selected).join('，') || '无'}`; }
}
function scopeCount() { $('access-token-scope-count').textContent = `已选择 ${tokenScopeSelection.size} 个仓库`; $('access-token-save').disabled = !editingTokenId && !tokenScopeSelection.size; }
function renderScopeOptions() {
  const q = $('access-token-search').value.trim().toLowerCase();
  $('access-token-repositories').replaceChildren(...state.repositories.filter(r => r.path.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)).map(repo => {
    const label = document.createElement('label'); label.className = 'token-scope-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = repo.id; input.checked = tokenScopeSelection.has(repo.id);
    input.onchange = () => { input.checked ? tokenScopeSelection.add(repo.id) : tokenScopeSelection.delete(repo.id); scopeCount(); };
    const text = document.createElement('span'); text.textContent = `${repo.path}${repo.enabled ? '' : '（已暂停）'}`; label.append(input, text); return label;
  })); scopeCount();
}
function openAccessToken(item) {
  resetTokenSecret();
  editingTokenId = item?.id || null; $('access-token-form').reset(); $('access-token-error').textContent = '';
  $('access-token-name').value = item?.name || ''; $('access-token-enabled').checked = item?.enabled ?? true;
  tokenScopeSelection = new Set((item?.repositoryIds || []).filter(id => state.repositories.some(r => r.id === id)));
  $('access-token-dialog-title').textContent = item ? '编辑读取权限' : '创建读取令牌'; $('access-token-save').textContent = item ? '保存权限' : '创建令牌'; $('access-token-edit-note').hidden = !item;
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
  event.preventDefault(); $('access-token-error').textContent = '';
  const id = editingTokenId, body = { name: $('access-token-name').value, repositoryIds: [...tokenScopeSelection], enabled: $('access-token-enabled').checked };
  void busy($('access-token-form'), async () => { const result = await api(id ? `access-tokens/${id}` : 'access-tokens', { method: id ? 'PATCH' : 'POST', body }); $('access-token-dialog').close(); selectedTokenId = result.token.id; resetTokenSecret(); await refresh(); toast(id ? '读取权限已保存，该令牌的客户端需重新连接' : '读取令牌已创建，点击查看或复制后配置到客户端'); }).catch(e => $('access-token-error').textContent = e.message);
});
async function readToken() {
  const id = selectedTokenId; if (!id) throw new Error('请先选择一个已启用的读取令牌');
  if (!token) { const result = await api(`access-tokens/${id}/secret`); if (selectedTokenId !== id || !state?.accessTokens.some(t => t.id === id && t.enabled)) throw new Error('令牌选择已变化，请重新选择'); token = result.token; }
  $('mcp-token').value = token; return token;
}
$('show-token').onclick = async () => { try { await readToken(); const hidden = $('mcp-token').type === 'password'; $('mcp-token').type = hidden ? 'text' : 'password'; $('show-token').textContent = hidden ? '隐藏' : '查看'; } catch(e) { toast(e.message, true); } };
$('copy-token').onclick = () => void readToken().then(copy).catch(e => toast(e.message, true));
$('rotate-token').onclick = async () => { const id = selectedTokenId; if (!id || !await confirm('重新生成读取令牌', '此令牌的旧值会立即失效，对应 AI 会话将关闭。授权仓库保持原选择，其他令牌不受影响。', '重新生成')) return; try { resetTokenSecret(); await api(`access-tokens/${id}/rotate`, { method: 'POST', body: {} }); await refresh(); toast('新令牌已生成，请重新复制并更新该客户端'); } catch(e) { toast(e.message, true); } };
$('schedule-form').addEventListener('submit', event => { event.preventDefault(); void api('schedule', { method: 'PUT', body: { intervalMinutes: Number($('interval').value) } }).then(refresh).then(() => toast('同步间隔已保存')).catch(e => toast(e.message, true)); });
$('build-settings-form').addEventListener('submit', event => { event.preventDefault(); void api('build-settings', { method: 'PUT', body: { timeoutMinutes: Number($('build-timeout').value) } }).then(refresh).then(() => toast('建图超时已保存，下次建图生效')).catch(e => toast(e.message, true)); });
$('password-form').addEventListener('submit', event => { event.preventDefault(); if ($('new-password').value !== $('confirm-password').value) { toast('两次输入的新密码不一致', true); return; } void busy($('password-form'), async () => { await api('password', { method: 'PUT', body: { currentPassword: $('current-password').value, newPassword: $('new-password').value } }); $('password-form').reset(); showLogin(); toast('密码已修改，请重新登录'); }).catch(e => toast(e.message, true)); });
setInterval(() => { if (state && !document.hidden) void refresh().catch(e => toast(e.message, true)); }, 8000);
setInterval(() => { if (state && !document.hidden && $('detail-dialog').open) { const repo = state.repositories.find(r => r.id === detailId); if (repo) $('build-progress-text').textContent = buildText(repo); } }, 1000);
void api('session').then(result => result.authenticated ? showApp() : showLogin()).catch(e => { showLogin(); $('login-error').textContent = e.message; });
