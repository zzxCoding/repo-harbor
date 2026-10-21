import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cleanError } from './security.mjs';

export async function gitRunner(c, home, options = {}) {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  if (c.caPem) await fs.writeFile(path.join(home, 'ca.pem'), c.caPem, { mode: 0o600 });
  const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: home,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: fileURLToPath(new URL('./askpass.mjs', import.meta.url)), ATLAS_GIT_USERNAME: c.username, ATLAS_GIT_TOKEN: c.token,
    ...(c.caPem ? { GIT_SSL_CAINFO: path.join(home, 'ca.pem') } : {}),
  };
  return args => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.file.allow=never', '-c', 'http.followRedirects=false', ...args], { ...options, env }).catch(error => { throw new Error(cleanError(error, [c.token], [home])); });
}
export async function remoteBranches(c, url) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-harbor-probe-'));
  try {
    const git = await gitRunner(c, home, { timeout: 20000 });
    const output = await git(['ls-remote', '--symref', '--', url, 'HEAD', 'refs/heads/*']);
    let defaultBranch = null; const names = new Set();
    for (const line of output.split('\n')) {
      const symref = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
      if (symref) defaultBranch = symref[1];
      const branch = /^[a-f0-9]{40,64}\trefs\/heads\/(.+)$/.exec(line);
      if (branch) names.add(branch[1]);
    }
    if (names.size > 10000) throw new Error('远端分支超过查询上限');
    return { defaultBranch, branches: [...names].sort().map(name => ({ name, default: name === defaultBranch })) };
  } catch (error) { throw new Error(cleanError(error, [c.token], [home])); }
  finally { await fs.rm(home, { recursive: true, force: true }); }
}

export async function command(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const stop = () => {
      timedOut = true;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {} }, 1500).unref();
    };
    const timer = setTimeout(stop, options.timeout || 5 * 60_000);
    options.signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', stop);
      if (timedOut) reject(new Error('同步任务超时或已停止'));
      else if (code !== 0) reject(new Error(`${file} 退出码 ${code}：${stderr || stdout}`));
      else resolve(stdout.trim());
    });
  });
}
