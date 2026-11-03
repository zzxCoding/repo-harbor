import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanError } from './security.mjs';

const integer = (minimum, maximum, value) => ({ type: 'integer', minimum, maximum, default: value });
const strings = { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 500 } };
const filters = {
  path: { type: 'string', description: 'Repository-relative directory; defaults to the repository root.' },
  include: { ...strings, description: 'Include file globs, e.g. ["**/*.java", "**/*.xml"]. Multiple globs are ORed.' },
  exclude: { ...strings, description: 'Exclude file globs, e.g. ["**/target/**", "**/*Test.java"].' },
  hidden: { type: 'boolean', default: false },
  includeIgnored: { type: 'boolean', default: false, description: 'Include files ignored by repository ignore rules.' },
  offset: integer(0, 100000, 0),
  limit: integer(1, 2000, 200),
  maxBytes: integer(4096, 200000, 80000),
};
export const sourceTools = [
  { name: 'find_files', description: 'List files by directory and include/exclude globs in one call. Prefer this over repeated path searches. Results are deterministic and paginated; symlinks are not followed.', inputSchema: { type: 'object', properties: filters, additionalProperties: false } },
  { name: 'grep', description: 'Fast ripgrep source search, independent of graph extraction. Search multiple literal patterns (OR) in one pass, filter directories/files, and return line-numbered matches with context or only matching file paths. Prefer this for literals, error messages, configuration, XML/SQL, and broad code investigation; use search/calls/refs for symbols and relationships. Check truncated and nextOffset.', inputSchema: { type: 'object', properties: {
    ...filters, patterns: strings, regex: { type: 'boolean', default: false, description: 'Use Rust regex syntax; no shell, PCRE2, backreferences, or multiline matching.' },
    caseSensitive: { type: 'boolean', default: true }, context: integer(0, 5, 2),
    output: { type: 'string', enum: ['content', 'files'], default: 'content' },
  }, required: ['patterns'], additionalProperties: false } },
  { name: 'get_files', description: 'Read up to 20 known files or line ranges in one call. Prefer this over repeated get_file calls. Returns compact line-numbered source once, per-file errors and nextOffset, with one shared commit. Sensitive values remain redacted. Check truncated and nextIndex before assuming all files were returned.', inputSchema: { type: 'object', properties: {
    files: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { file: { type: 'string', minLength: 1, maxLength: 500 }, offset: integer(1, 10000000, 1), limit: integer(1, 2000, 200) }, required: ['file'], additionalProperties: false } },
    maxBytes: integer(4096, 200000, 100000),
  }, required: ['files'], additionalProperties: false } },
];

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('工具参数格式错误或包含不支持的字段');
}
function number(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`整数参数必须在 ${min}–${max} 范围内`);
  return value;
}
function boolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('开关参数必须为布尔值');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.length || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('文本参数需为 1–500 个字符，且不包含控制字符');
  return value;
}
function list(value, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error('模式列表需包含 1–32 项');
  return value.map(text);
}
function relative(value) {
  text(value);
  if (path.isAbsolute(value) || value.includes('\\') || value.split('/').includes('..') || /^[a-z]:/i.test(value)) throw new Error('路径必须位于当前仓库内，不能包含绝对路径或 ..');
  return value;
}
async function directory(root, value = '.') {
  relative(value);
  const realRoot = await fs.realpath(root), candidate = await fs.realpath(path.resolve(root, value));
  const rel = path.relative(realRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !(await fs.stat(candidate)).isDirectory()) throw new Error('搜索目录必须位于当前仓库内');
  return value === '.' ? '.' : `./${value}`;
}

// 排除规则最后追加，用户的 include 不能把凭据、密钥或 Git 元数据重新纳入全文搜索。
// 与单文件读取的敏感文件分类一致，并对 id_* 文件采用更保守的排除范围。
const privateGlobs = ['!.git', '!.git/**', '!**/.git/**', '!.env', '!.env.*', '!{.npmrc,.pypirc,.netrc}', '!{credential,credentials,secret,secrets,service-account}.{json,yaml,yml,toml,ini}', '!{credential,credentials,secret,secrets,service-account}.*.{json,yaml,yml,toml,ini}', '!*.{key,pem,p12,pfx}', '!id_*'];
function rgOptions(args) {
  const options = ['--no-config', '--no-ignore-parent', '--no-ignore-global', '--no-require-git', '--no-follow', '--sort', 'path', '--color', 'never', '--max-filesize', '4M'];
  if (boolean(args.hidden, false)) options.push('--hidden');
  if (boolean(args.includeIgnored, false)) options.push('--no-ignore');
  for (const glob of list(args.include)) { if (glob.startsWith('!')) throw new Error('include 不接受否定模式，请使用 exclude'); options.push('--glob', glob); }
  for (const glob of list(args.exclude)) { if (glob.startsWith('!')) throw new Error('exclude 不需要 ! 前缀'); options.push('--glob', `!${glob}`); }
  for (const glob of privateGlobs) options.push('--iglob', glob);
  return options;
}

// 按记录处理 stdout，避免大仓库或超长代码行占满内存；达到边界后终止本次 rg。
async function scan(root, options, delimiter, accept, signal) {
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn('rg', options, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' } });
    let pending = '', stderr = '', scannedBytes = 0, stopped, failure;
    const stop = reason => { if (!stopped) { stopped = reason; child.kill('SIGKILL'); } };
    const abort = () => { failure = new Error('查询已取消'); stop('cancelled'); };
    const timer = setTimeout(() => stop('timeout'), 15000); timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 4000); });
    child.stdout.on('data', chunk => {
      if (stopped) return;
      scannedBytes += Buffer.byteLength(chunk);
      if (scannedBytes > 32 * 1024 * 1024) return stop('scan_output_limit');
      pending += chunk;
      // 单个 JSON 行可能包含经转义的源码，单条记录最多缓冲 8 MiB。
      if (Buffer.byteLength(pending) > 8 * 1024 * 1024) return stop('record_size_limit');
      let cut;
      while (!stopped && (cut = pending.indexOf(delimiter)) >= 0) {
        const record = pending.slice(0, cut); pending = pending.slice(cut + delimiter.length);
        if (!record) continue;
        try { const reason = accept(record); if (reason) stop(reason); }
        catch (error) { failure = error; stop('invalid_output'); }
      }
    });
    child.on('error', error => { failure = error.code === 'ENOENT' ? new Error('未安装 ripgrep，请安装 rg 后重试；Docker 镜像已包含此依赖') : error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      if (!stopped && code !== 0 && code !== 1) return reject(new Error(`ripgrep 查询失败：${stderr || `exit ${code}`}`));
      resolve(stopped);
    });
  });
}

async function findOrGrep(name, args, snapshot, signal) {
  const definition = sourceTools.find(tool => tool.name === name);
  object(args, Object.keys(definition.inputSchema.properties));
  const offset = number(args.offset, 0, 0, 100000), limit = number(args.limit, 200, 1, 2000), maxBytes = number(args.maxBytes, 80000, 4096, 200000);
  const root = snapshot.root, searchPath = await directory(root, args.path), options = rgOptions(args);
  const results = []; let seen = 0, bytes = 0, shortenedLines = 0;
  let content = false;
  if (name === 'find_files') options.push('--files', '--null');
  else {
    const patterns = list(args.patterns, true);
    if (!boolean(args.regex, false)) options.push('--fixed-strings');
    if (!boolean(args.caseSensitive, true)) options.push('--ignore-case');
    const output = args.output ?? 'content';
    if (!['content', 'files'].includes(output)) throw new Error('output 必须为 content 或 files');
    const context = number(args.context, 2, 0, 5);
    content = output === 'content';
    options.push(...(content ? ['--json', '--encoding', 'utf-8', '--context', String(context)] : ['--files-with-matches', '--null']));
    for (const pattern of patterns) options.push('--regexp', pattern);
  }
  options.push('--', searchPath);
  const reason = await scan(root, options, content ? '\n' : '\0', record => {
    let result;
    if (content) {
      const event = JSON.parse(record);
      if (!['match', 'context'].includes(event.type)) return;
      if (event.data.path.text === undefined || event.data.lines.text === undefined) return;
      result = { file: event.data.path.text.replace(/^\.\//, ''), line: event.data.line_number, text: event.data.lines.text.replace(/\r?\n$/, ''), isMatch: event.type === 'match' };
    } else result = { file: record.replace(/^\.\//, '') };
    if (seen++ < offset) return;
    if (results.length >= limit) return 'limit';
    // 超长行单独标识，AI 可用 get_files 读取该行；不在一条结果里塞入整个压缩文件。
    if (content && Buffer.byteLength(JSON.stringify(result)) > Math.min(8192, maxBytes - 512)) {
      if (Buffer.byteLength(JSON.stringify({ ...result, text: '', lineTruncated: true })) > Math.min(8192, maxBytes - 512)) return 'record_size_limit';
      do { result.text = result.text.slice(0, Math.floor(result.text.length / 2)); result.lineTruncated = true; }
      while (Buffer.byteLength(JSON.stringify(result)) > Math.min(8192, maxBytes - 512));
    }
    const size = Buffer.byteLength(JSON.stringify(result)) + 1;
    if (size > maxBytes && !results.length) return 'record_size_limit';
    if (bytes + size > maxBytes) return 'maxBytes';
    if (result.lineTruncated) shortenedLines++;
    results.push(result); bytes += size;
  }, signal);
  return { results, offset, limit, returned: results.length, truncated: Boolean(reason), ...(reason ? { reason } : {}), ...(['limit', 'maxBytes'].includes(reason) ? { nextOffset: offset + results.length } : {}), ...(shortenedLines ? { shortenedLines } : {}), scope: { ignoredFilesIncluded: Boolean(args.includeIgnored), hiddenFilesIncluded: Boolean(args.hidden), symlinksFollowed: false, sensitiveFilesExcluded: true, maxFileBytes: 4 * 1024 * 1024 } };
}

async function readFiles(args, snapshot, engine, signal) {
  object(args, ['files', 'maxBytes']);
  if (!Array.isArray(args.files) || !args.files.length || args.files.length > 20) throw new Error('files 需包含 1–20 个文件或行号范围');
  const maxBytes = number(args.maxBytes, 100000, 4096, 200000);
  const requests = args.files.map(item => {
    object(item, ['file', 'offset', 'limit']);
    return { file: text(item.file), offset: number(item.offset, 1, 1, 10000000), limit: number(item.limit, 200, 1, 2000) };
  });
  const output = []; let cursor = 0;
  // 并发只用于有界的文件读取；输出仍按输入顺序排列，单个文件失败不丢失其他证据。
  await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => {
    while (cursor < requests.length) {
      signal?.throwIfAborted();
      const index = cursor++, item = requests[index];
      try {
        relative(item.file);
        const result = await engine.call('get_file', { ...item, maxBytes: Math.min(20000, Math.floor(maxBytes / 2)), includeGraphContext: false, allowSensitive: false });
        const block = result.content.find(block => block.type === 'text');
        if (result.isError) throw new Error(block?.text || '读取文件失败');
        const value = JSON.parse(block.text);
        output[index] = { file: item.file, offset: value.offset, content: value.content, truncated: value.truncated, ...(value.page?.nextOffset !== undefined ? { nextOffset: value.page.nextOffset } : {}), ...(value.sensitive ? { sensitive: value.sensitive } : {}) };
      } catch (error) { output[index] = { file: item.file, isError: true, error: cleanError(error, [], [snapshot.root]) }; }
    }
  }));
  const results = []; let bytes = 0;
  for (const entry of output) {
    // 即使 JSON 转义令单条结果变大，也保证首条能够返回且不会丢失分页位置。
    if (results.length === 0 && Buffer.byteLength(JSON.stringify(entry)) > maxBytes) {
      entry.content = ''; entry.truncated = true; entry.nextOffset = entry.offset;
      entry.error = '该范围超过总响应预算，请缩小 limit 或提高 maxBytes 后读取';
    }
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes + size > maxBytes) break;
    results.push(entry); bytes += size;
  }
  return { results, requested: requests.length, returned: results.length, truncated: results.length < requests.length, ...(results.length < requests.length ? { nextIndex: results.length } : {}), maxBytes };
}

export async function callSourceTool(name, args, snapshot, engine, signal) {
  return name === 'get_files' ? await readFiles(args, snapshot, engine, signal) : await findOrGrep(name, args, snapshot, signal);
}
