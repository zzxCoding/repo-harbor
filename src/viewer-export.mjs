import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);

export const VIEWER_SCHEMA = 1;
export function relativeSourceFile(root, file) {
  if (typeof file !== 'string') return null;
  const relative = path.relative(root, path.resolve(root, file));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).includes('.git')) return null;
  return relative.split(path.sep).join('/');
}
export async function exportViewer(snapshot, cache, commit) {
  const dest = path.join(cache, 'viewer-v1');
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dest, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion === VIEWER_SCHEMA && manifest.commit === commit) return;
    throw new Error('已有查看地图数据与当前版本不匹配');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Codegraph 3.0.0 exposes symbol graphs but not its definition-id helper. Use
  // that exact pinned implementation instead of guessing overload identities.
  const { defNodeId } = await import(new URL('graphs/symbol-graph.js', pathToFileURL(require.resolve('@lzehrung/codegraph'))).href);
  const temp = await fs.mkdtemp(path.join(cache, 'viewer-building-'));
  await fs.mkdir(path.join(temp, 'symbols'));
  const files = [...new Set([...snapshot.fileGraph.nodes].map(file => relativeSourceFile(snapshot.root, file)).filter(Boolean))].sort();
  const positions = new Map(files.map((file, index) => [file, index]));
  const edges = [], external = [], seen = new Set();
  for (const edge of snapshot.fileGraph.edges) {
    const from = positions.get(relativeSourceFile(snapshot.root, edge.from));
    if (from === undefined) continue;
    if (edge.to.type === 'file') {
      const to = positions.get(relativeSourceFile(snapshot.root, edge.to.path));
      const key = `${from}:${to}`;
      if (to !== undefined && !seen.has(key)) { edges.push([from, to]); seen.add(key); }
    } else if (edge.to.type === 'external') external.push({ from, name: edge.to.name });
  }
  // Definitions have source positions. Keep only these local symbols in each file view,
  // and take their relation edges from the already-built detailed native symbol graph.
  const groups = new Map(); const definitions = new Map();
  for (const module of snapshot.index.modules.values()) {
    const fileIndex = positions.get(relativeSourceFile(snapshot.root, module.file));
    if (fileIndex === undefined) continue;
    const symbols = [], ids = new Set();
    for (const def of [...module.locals, ...module.exports.filter(e => e.type === 'local').map(e => e.target)]) {
      const id = defNodeId(def);
      if (ids.has(id)) continue;
      ids.add(id);
      const node = snapshot.symbolGraph.nodes.get(id);
      const symbol = { name: def.localName, kind: node?.kind || 'symbol', line: def.range?.start.line || 1, endLine: def.range?.end.line || def.range?.start.line || 1 };
      definitions.set(id, { fileIndex, index: symbols.length }); symbols.push(symbol);
    }
    groups.set(fileIndex, { symbols, edges: [] });
  }
  for (const edge of snapshot.symbolGraph.edges) {
    const from = definitions.get(edge.from), to = definitions.get(edge.to);
    if (from && to && from.fileIndex === to.fileIndex) groups.get(from.fileIndex).edges.push({ from: from.index, to: to.index, label: edge.label || '引用' });
  }
  let symbolCount = 0;
  for (let i = 0; i < files.length; i++) {
    const group = groups.get(i) || { symbols: [], edges: [] }; symbolCount += group.symbols.length;
    await fs.writeFile(path.join(temp, 'symbols', `${i}.json`), JSON.stringify(group));
  }
  const manifest = { schemaVersion: VIEWER_SCHEMA, commit, generatedAt: new Date().toISOString(), files, edges, external, symbolCount };
  await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
  await fs.rename(temp, dest);
}
