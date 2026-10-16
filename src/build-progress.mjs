export const DEFAULT_BUILD_TIMEOUT_MINUTES = 120;
export const buildPhases = { starting: '启动解析器', discovery: '扫描文件', indexing: '文件索引', symbols: '符号关系', viewer: '生成查看地图', ready: '地图就绪', validating: '验证地图', failed: '建图失败' };
export function buildTimeoutMinutes(value) {
  const minutes = Number(value ?? DEFAULT_BUILD_TIMEOUT_MINUTES);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 360) throw new Error('建图超时需为 5–360 分钟');
  return minutes;
}
export function decodeProgress(line) {
  if (!line.startsWith('@atlas-progress ')) return null;
  try {
    const input = JSON.parse(line.slice(16));
    if (!Object.hasOwn(buildPhases, input.phase)) return null;
    const output = { phase: input.phase };
    for (const key of ['current', 'total', 'elapsedMs']) if (Number.isFinite(input[key]) && input[key] >= 0) output[key] = Math.floor(input[key]);
    if (output.current !== undefined && output.total !== undefined && output.current > output.total) return null;
    if (input.timings) {
      output.timings = {};
      for (const key of ['baseMs', 'parseMs', 'graphMs', 'symbolsMs', 'workerThreads']) if (Number.isFinite(input.timings[key]) && input.timings[key] >= 0) output.timings[key] = Math.round(input.timings[key]);
    }
    return output;
  } catch { return null; }
}
