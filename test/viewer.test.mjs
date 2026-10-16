import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSnapshotSource } from '../src/viewer.mjs';
import { relativeSourceFile } from '../src/viewer-export.mjs';

test('viewer source is bounded and cannot follow paths or links outside its commit', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-viewer-test-'));
  const root = path.join(temp, 'source'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'safe.ts'), 'first\nsecond\nthird\n');
  await fs.writeFile(path.join(temp, 'secret.txt'), 'must-never-be-returned');
  await fs.symlink('../secret.txt', path.join(root, 'escape.ts'));
  const value = await readSnapshotSource({ root }, 'safe.ts', 2, 1);
  assert.deepEqual(value.lines, ['second']); assert.equal(value.nextOffset, 3);
  await assert.rejects(readSnapshotSource({ root }, '../secret.txt'), { status: 400 });
  await assert.rejects(readSnapshotSource({ root }, 'escape.ts'), { status: 403 });
  await assert.rejects(readSnapshotSource({ root }, 'safe.ts', 0, 200), { status: 400 });
  await assert.rejects(readSnapshotSource({ root }, 'safe.ts', 1, 501), { status: 400 });
  await fs.writeFile(path.join(root, 'binary.ts'), Buffer.from([0, 1, 2]));
  await assert.rejects(readSnapshotSource({ root }, 'binary.ts'), { status: 415 });
  await fs.writeFile(path.join(root, 'long.ts'), 'a'.repeat(600000) + '\nnext');
  const long = await readSnapshotSource({ root }, 'long.ts', 1, 200);
  assert(long.truncated); assert(long.lines[0].length < 512 * 1024); assert.equal(long.nextOffset, 2);
  assert.equal(relativeSourceFile(root, path.join(temp, 'secret.txt')), null);
  assert.equal(relativeSourceFile(root, path.join(root, '.git/config')), null);
});
