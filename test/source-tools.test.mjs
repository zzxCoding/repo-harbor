import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { callSourceTool } from '../src/source-tools.mjs';

const exec = promisify(execFile);
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-source-tools-')), root = path.join(temp, 'repo');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'target'));
  const files = {
    'src/Order.java': 'package example;\n// 中文注释\nclass Order {\n  String error = "PAYMENT_FAILED";\n  String literal = "a.b";\n}\n',
    'src/OrderTest.java': 'PAYMENT_FAILED\n',
    'src/mapper.xml': '<mapper>\n<select>payment_failed</select>\n</mapper>\n',
    'target/generated.java': 'PAYMENT_FAILED\n',
    '.gitignore': 'target/\n',
    '.settings': 'VISIBLE_HIDDEN\n',
    '.env': 'SECRET_SENTINEL\n', '.env.prod': 'SECRET_SENTINEL\n',
    'credentials.prod.json': 'SECRET_SENTINEL\n', 'SECRET.yaml': 'SECRET_SENTINEL\n',
    'src/service-account.json': 'SECRET_SENTINEL\n', 'private.PEM': 'SECRET_SENTINEL\n',
    'id_rsa': 'SECRET_SENTINEL\n', '.npmrc': 'SECRET_SENTINEL\n',
  };
  for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(root, file), content);
  await fs.writeFile(path.join(temp, 'outside.txt'), 'OUTSIDE_SENTINEL\n');
  await fs.symlink(path.join(temp, 'outside.txt'), path.join(root, 'outside-link.txt'));
  await fs.symlink(temp, path.join(root, 'outside-dir'));
  await fs.symlink(path.join(root, '.env'), path.join(root, 'secret-alias.java'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return { root, call: (name, args, signal) => callSourceTool(name, args, { root }, undefined, signal) };
}

test('ripgrep tools filter paths and content in one pass, preserve Chinese and paginate without gaps', async t => {
  const { call, root } = await fixture(t);
  const args = { patterns: ['PAYMENT_FAILED', 'a.b'], include: ['src/*.java'], exclude: ['**/*Test.java'], context: 0 };
  const result = await call('grep', args);
  assert.deepEqual(result.results.map(row => row.line), [4, 5]);
  const expected = await exec('rg', ['--json', '--fixed-strings', '-e', 'PAYMENT_FAILED', '-e', 'a.b', 'src/Order.java'], { cwd: root });
  const direct = expected.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === 'match').map(event => ({ file: event.data.path.text, line: event.data.line_number, text: event.data.lines.text.trimEnd(), isMatch: true }));
  assert.deepEqual(result.results, direct, '与本地 rg 使用相同模式时命中证据一致');
  const contextual = await call('grep', { patterns: ['class Order'], context: 1 });
  assert(contextual.results.some(row => row.text === '// 中文注释' && !row.isMatch));
  assert.equal((await call('grep', { patterns: ['PAYMENT_FAILED'], caseSensitive: false, output: 'files' })).results.length, 3);
  assert.equal((await call('grep', { patterns: ['PAYMENT_[A-Z]+'], regex: true, context: 0 })).results.length, 2);
  const listed = await call('find_files', { include: ['**/*.java', '**/*.xml'] });
  assert.equal(listed.results.length, 3);
  assert.equal((await call('find_files', { include: ['**/*.java'], includeIgnored: true })).results.length, 3);
  assert.equal((await call('find_files', { path: 'src', include: ['*.xml'] })).results[0].file, 'src/mapper.xml');
  let offset = 0; const pages = [];
  for (;;) {
    const page = await call('grep', { ...args, limit: 1, offset }); pages.push(...page.results);
    if (!page.truncated) break;
    assert(page.nextOffset > offset); offset = page.nextOffset;
  }
  assert.deepEqual(pages, result.results);
  const none = await call('grep', { patterns: ['NO_SUCH_TERM'], context: 0 });
  assert.deepEqual(none.results, []); assert.equal(none.truncated, false);
});

test('bulk searches do not expose sensitive files, follow symlinks, escape roots or accept executable arguments', async t => {
  const { call } = await fixture(t);
  const sensitive = await call('grep', { patterns: ['SECRET_SENTINEL', 'OUTSIDE_SENTINEL'], include: ['**/*'], hidden: true, includeIgnored: true, context: 0 });
  assert.deepEqual(sensitive.results, []);
  const hidden = await call('grep', { patterns: ['VISIBLE_HIDDEN'], hidden: true });
  assert.equal(hidden.results[0].file, '.settings');
  const files = await call('find_files', { hidden: true, includeIgnored: true });
  assert(!files.results.some(row => /env|credentials|SECRET|service-account|PEM|id_rsa|npmrc|link|alias/.test(row.file)));
  for (const bad of ['../', '/tmp', 'outside-dir', 'src/../../', 'C:\\Windows', '..\\outside']) await assert.rejects(call('grep', { patterns: ['x'], path: bad }));
  for (const args of [{ patterns: [] }, { patterns: ['x'], shell: true }, { patterns: ['x'], limit: 0 }, { patterns: ['x'], regex: 'false' }, { patterns: ['x'], include: ['!*.java'] }, { patterns: ['x'], maxBytes: 1 }]) await assert.rejects(call('grep', args));
  await assert.rejects(call('grep', { patterns: ['['], regex: true }), /ripgrep/);
  assert.deepEqual((await call('grep', { patterns: ['--pre=touch /tmp/not-executed', '$(touch /tmp/not-executed)', '; echo leak'] })).results, []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(call('grep', { patterns: ['x'] }, controller.signal), /abort/i);
});

test('large search outputs expose limits and allow exact continuation without silently dropping long lines', async t => {
  const { call, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'src/Large.java'), Array.from({ length: 80 }, (_, i) => `MATCH_${i} ${'a'.repeat(180)}`).join('\n'));
  const all = await call('grep', { patterns: ['MATCH_'], context: 0, maxBytes: 100000 });
  let offset = 0; const rows = [];
  for (;;) {
    const page = await call('grep', { patterns: ['MATCH_'], context: 0, maxBytes: 4096, offset });
    assert(Buffer.byteLength(JSON.stringify(page.results)) <= 4098); rows.push(...page.results);
    if (!page.truncated) break;
    assert.equal(page.reason, 'maxBytes'); assert(page.nextOffset > offset); offset = page.nextOffset;
  }
  assert.deepEqual(rows, all.results);
  await fs.writeFile(path.join(root, 'src/Long.java'), `LONG_MATCH ${'x'.repeat(30000)}\n`);
  const long = await call('grep', { patterns: ['LONG_MATCH'], maxBytes: 4096, context: 0 });
  assert.equal(long.results[0].lineTruncated, true); assert.equal(long.shortenedLines, 1);
  assert(Buffer.byteLength(JSON.stringify(long.results)) <= 4096);
});
