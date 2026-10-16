import Graph from '/viewer-vendor/graphology.js';
import Sigma from '/viewer-vendor/sigma.js';
import forceAtlas2 from '/viewer-vendor/graphology-layout-forceatlas2.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), repoId = params.get('repo'), requestedCommit = params.get('commit');
let data, viewId, selected = null, fileData, sigma, mode = 'files', overview = true, requestSequence = 0, highlightedLine = null;
let out = [], incoming = [], degrees = [], authTimer;
const MAX_NODES = 250, MAX_EDGES = 5000;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const name = file => file.split('/').pop();
async function api(path) {
  const response = await fetch(`/api/${path}`, { cache: 'no-store' }); const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) { clearPrivate(); $('map-message').textContent = '登录已过期，请返回仓库重新登录。'; }
    throw new Error(value.error || '读取地图失败');
  }
  return value;
}
function clearPrivate() { requestSequence++; sigma?.kill(); sigma = null; data = null; fileData = null; viewId = null; out = []; incoming = []; degrees = []; selected = null; $('map-workspace').hidden = true; $('map-message').hidden = false; for (const id of ['file-list', 'source-code', 'symbol-list', 'dependencies', 'dependents']) $(id).replaceChildren(); for (const id of ['repo-version', 'repo-counts', 'file-name', 'file-path', 'external-deps', 'source-range', 'graph-caption']) $(id).textContent = ''; delete $('repo-version').dataset.commit; $('repo-name').textContent = '仓库地图'; clearInterval(authTimer); }
function message(text, error = false) { $('map-message').hidden = false; $('map-message').textContent = text; $('map-message').classList.toggle('error', error); }
function button(text, callback) { const b = document.createElement('button'); b.textContent = text; b.onclick = callback; return b; }
function renderFiles() {
  if (!data) return;
  const query = $('file-search').value.trim().toLowerCase();
  const matches = data.files.map((file, i) => ({ file, i })).filter(item => item.file.toLowerCase().includes(query));
  $('file-count').textContent = `${matches.length} 个匹配文件${matches.length > 160 ? '，先显示 160 个，可继续输入缩小范围' : ''}`;
  $('file-list').replaceChildren(...matches.slice(0, 160).map(({ file, i }) => { const b = button(file, () => void selectFile(i)); b.title = file; b.classList.toggle('selected', selected === i); b.dataset.fileIndex = i; return b; }));
}
function fileGraph() {
  const g = new Graph({ type: 'directed' }); let indices;
  if (overview || selected === null) indices = data.files.map((_, i) => i).sort((a, b) => degrees[b] - degrees[a] || data.files[a].localeCompare(data.files[b])).slice(0, MAX_NODES);
  else indices = [...new Set([selected, ...out[selected], ...incoming[selected]])].slice(0, MAX_NODES);
  for (const i of indices) g.addNode(`f:${i}`, { label: name(data.files[i]), fullLabel: data.files[i], fileIndex: i, kind: 'file', size: i === selected ? 11 : Math.min(9, 4 + Math.log2(degrees[i] + 1)), color: i === selected ? '#187e77' : '#5984da', forceLabel: i === selected });
  let edges = 0;
  for (const [from, to] of data.edges) if (g.hasNode(`f:${from}`) && g.hasNode(`f:${to}`) && edges < MAX_EDGES) { if (!g.hasEdge(`f:${from}`, `f:${to}`)) { g.addDirectedEdge(`f:${from}`, `f:${to}`); edges++; } }
  const total = overview || selected === null ? data.files.length : new Set([selected, ...out[selected], ...incoming[selected]]).size;
  $('graph-caption').textContent = overview || selected === null ? `全库概览：显示 ${g.order} / ${total} 个文件，优先展示关联较多的文件。搜索或点击文件查看局部关系。` : `当前文件与直接依赖：显示 ${g.order} / ${total} 个文件。连线方向见右侧依赖列表。`;
  if (edges === MAX_EDGES) $('graph-caption').textContent += ` 连线最多显示 ${MAX_EDGES} 条。`;
  return g;
}
function symbolGraph() {
  const g = new Graph({ type: 'directed' }); const symbols = fileData?.symbols || [];
  for (const [i, s] of symbols.slice(0, MAX_NODES).entries()) g.addNode(`s:${i}`, { label: s.name, fullLabel: `${s.name} · 第 ${s.line} 行`, symbolIndex: i, kind: 'symbol', size: 5, color: '#8465c8' });
  for (const edge of fileData?.edges || []) if (g.hasNode(`s:${edge.from}`) && g.hasNode(`s:${edge.to}`) && g.size < MAX_EDGES && !g.hasEdge(`s:${edge.from}`, `s:${edge.to}`)) g.addDirectedEdge(`s:${edge.from}`, `s:${edge.to}`);
  $('graph-caption').textContent = `当前文件的定义与文件内引用关系：显示 ${g.order} / ${symbols.length} 个符号。跨文件关系请查看“文件依赖”。`;
  return g;
}
function renderGraph() {
  if (!data) return;
  sigma?.kill(); sigma = null; const g = mode === 'symbols' ? symbolGraph() : fileGraph();
  $('mode-files').classList.toggle('active', mode === 'files'); $('mode-symbols').classList.toggle('active', mode === 'symbols');
  const count = Math.max(1, g.order); let n = 0;
  g.forEachNode(node => { const angle = ++n * Math.PI * 2 / count; g.setNodeAttribute(node, 'x', Math.cos(angle) * 10); g.setNodeAttribute(node, 'y', Math.sin(angle) * 10); if (g.order <= 40) g.setNodeAttribute(node, 'forceLabel', true); });
  if (g.order > 1) forceAtlas2.assign(g, { iterations: 55, settings: { barnesHutOptimize: true, gravity: 1, scalingRatio: 10, slowDown: 3 } });
  try {
    sigma = new Sigma(g, $('graph-container'), { renderLabels: true, labelDensity: .18, labelSize: 11, labelFont: 'system-ui, sans-serif', defaultEdgeColor: '#bdcbe0', defaultNodeColor: '#5984da', hideEdgesOnMove: true, hideLabelsOnMove: true, labelRenderedSizeThreshold: 6 });
    sigma.on('clickNode', ({ node }) => { const attrs = g.getNodeAttributes(node); if (attrs.kind === 'file') void selectFile(attrs.fileIndex); else void selectSymbol(attrs.symbolIndex); });
    $('graph-fallback').hidden = true;
  } catch { $('graph-fallback').hidden = false; }
}
function renderRelations() {
  for (const [id, indices] of [['dependencies', out[selected]], ['dependents', incoming[selected]]]) {
    const list = [...new Set(indices)].sort((a, b) => data.files[a].localeCompare(data.files[b]));
    $(id).replaceChildren(...list.slice(0, 150).map(i => button(data.files[i], () => void selectFile(i))));
    if (!list.length) { const p = document.createElement('p'); p.textContent = '无已解析的关系'; $(id).append(p); }
    if (list.length > 150) { const p = document.createElement('p'); p.textContent = `另有 ${list.length - 150} 个，请使用文件搜索`; $(id).append(p); }
  }
  const external = [...new Set(data.external.filter(e => e.from === selected).map(e => e.name))];
  $('external-deps').textContent = external.length ? `外部依赖：${external.slice(0, 30).join('，')}${external.length > 30 ? `，另有 ${external.length - 30} 个` : ''}` : '';
}
function renderSymbols() {
  if (!fileData) return;
  const q = $('symbol-search').value.trim().toLowerCase(); const all = fileData.symbols.map((s, i) => ({ s, i })).filter(({ s }) => s.name.toLowerCase().includes(q));
  $('symbol-summary').textContent = `符号（${fileData.symbols.length}）`;
  $('symbol-list').replaceChildren(...all.slice(0, 300).map(({ s, i }) => { const b = button(s.name, () => void selectSymbol(i)); const span = document.createElement('small'); span.textContent = `第 ${s.line} 行`; b.append(span); return b; }));
  if (all.length > 300) { const p = document.createElement('p'); p.textContent = `匹配 ${all.length} 个，先显示 300 个；继续输入可缩小范围。`; p.className = 'muted small'; $('symbol-list').append(p); }
}
function renderSource() {
  $('source-range').textContent = `第 ${fileData.offset}–${fileData.offset + fileData.lines.length - 1} 行 / 共 ${fileData.totalLines} 行`;
  $('source-code').replaceChildren(...fileData.lines.map((text, i) => { const line = fileData.offset + i, div = document.createElement('div'); div.className = `code-line${highlightedLine === line ? ' highlight' : ''}`; div.dataset.line = line; const number = document.createElement('span'); number.className = 'code-number'; number.textContent = line; const code = document.createElement('span'); code.className = 'code-text'; code.textContent = text; div.append(number, code); return div; }));
  $('source-prev').disabled = fileData.offset === 1; $('source-next').disabled = !fileData.nextOffset;
  if (highlightedLine) $('source-code').querySelector(`[data-line="${highlightedLine}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
async function loadFile(offset = 1) {
  const sequence = ++requestSequence, index = selected, pin = viewId; $('source-message').textContent = '正在读取该版本的源码…';
  try {
    const value = await api(`maps/${pin}/file?${new URLSearchParams({ file: data.files[index], offset, limit: 200 })}`);
    if (sequence !== requestSequence) return;
    if (value.repository.commit !== $('repo-version').dataset.commit) throw new Error('源码版本与地图不一致，请重新打开');
    fileData = value; $('mode-symbols').disabled = !value.symbols.length; $('file-details').hidden = false; $('source-message').textContent = value.truncated ? '当前页内容过长，显示已截取的部分。' : '';
    renderSymbols(); renderSource(); if (mode === 'symbols') renderGraph();
  } catch (error) { if (sequence === requestSequence && data) { $('file-details').hidden = true; $('source-message').textContent = error.message; } }
}
async function selectFile(index) {
  if (!data || !Number.isInteger(index) || !data.files[index]) return;
  selected = index; overview = false; fileData = null; highlightedLine = null; mode = 'files'; $('symbol-search').value = ''; $('file-details').hidden = true;
  $('file-name').textContent = name(data.files[index]); $('file-path').textContent = data.files[index]; $('mode-symbols').disabled = true;
  renderFiles(); renderRelations(); renderGraph(); await loadFile();
}
async function selectSymbol(index) {
  const symbol = fileData?.symbols[index]; if (!symbol) return;
  highlightedLine = symbol.line;
  if (symbol.line < fileData.offset || symbol.line >= fileData.offset + fileData.lines.length) await loadFile(Math.max(1, symbol.line - 20)); else renderSource();
}
async function loadMap() {
  if (!repoId) throw new Error('缺少仓库信息，请从仓库详情打开地图');
  const value = await api(`repositories/${encodeURIComponent(repoId)}/map?${new URLSearchParams(requestedCommit ? { commit: requestedCommit } : {})}`);
  if (value.preparing) { message(value.message); setTimeout(() => void loadMap().catch(error => message(error.message, true)), 3000); return; }
  data = value.graph; viewId = value.viewId;
  $('repo-name').textContent = value.repository.name;
  $('repo-version').textContent = `${value.repository.branch} @ ${value.repository.commit} · 发布于 ${new Date(value.repository.indexedAt).toLocaleString('zh-CN', { hour12: false })}`; $('repo-version').dataset.commit = value.repository.commit;
  $('repo-counts').textContent = `${data.files.length} 个索引文件 · ${data.edges.length} 条文件依赖`;
  out = data.files.map(() => []); incoming = data.files.map(() => []); degrees = data.files.map(() => 0);
  for (const [from, to] of data.edges) { out[from].push(to); incoming[to].push(from); degrees[from]++; degrees[to]++; }
  $('map-message').hidden = true; $('map-workspace').hidden = false; renderFiles(); renderGraph();
  authTimer = setInterval(() => { void api('session').then(value => { if (!value.authenticated) { clearPrivate(); message('登录已过期，请返回仓库重新登录。'); } }).catch(() => {}); }, 30000);
}
$('file-search').oninput = renderFiles; $('symbol-search').oninput = renderSymbols;
$('mode-files').onclick = () => { mode = 'files'; renderGraph(); };
$('mode-symbols').onclick = () => { if (fileData) { mode = 'symbols'; renderGraph(); } };
$('show-overview').onclick = () => { mode = 'files'; overview = true; renderGraph(); };
$('zoom-in').onclick = () => sigma?.getCamera().animatedZoom({ duration: reduced() ? 0 : 180 });
$('zoom-out').onclick = () => sigma?.getCamera().animatedUnzoom({ duration: reduced() ? 0 : 180 });
$('reset-camera').onclick = () => sigma?.getCamera().animatedReset({ duration: reduced() ? 0 : 180 });
$('source-prev').onclick = () => void loadFile(Math.max(1, fileData.offset - 200)); $('source-next').onclick = () => void loadFile(fileData.nextOffset);
$('copy-source').onclick = async () => { const text = fileData?.lines.join('\n') || ''; try { if (navigator.clipboard) await navigator.clipboard.writeText(text); else { const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); } $('copy-source').textContent = '已复制'; setTimeout(() => $('copy-source').textContent = '复制当前页', 1500); } catch { $('source-message').textContent = '浏览器不允许复制，请选择源码手工复制。'; } };
void loadMap().catch(error => message(error.message, true));
