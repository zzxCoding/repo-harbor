import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export function equalSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('管理密码需为 12–256 个字符');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}
export async function passwordMatches(password, saved) {
  if (typeof password !== 'string' || password.length > 256 || !saved) return false;
  const hash = await scrypt(password, saved.salt, 64);
  return equalSecret(hash.toString('hex'), saved.hash);
}
export function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), bytes: bytes.toString('base64') };
}
export function decrypt(value, key) {
  if (!value) return '';
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(value.bytes, 'base64')), cipher.final()]).toString('utf8');
}
export function cleanError(error, secrets = [], roots = []) {
  let text = String(error?.message ?? error).slice(0, 4000);
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[已隐藏]');
  for (const root of roots.filter(Boolean)) text = text.split(root).join('[数据目录]');
  return text.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[已隐藏]@').slice(0, 1200);
}
export function normalizedBaseUrl(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('GitLab 地址需为 HTTP/HTTPS 服务地址，不包含凭据、查询参数或片段');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
export function sameGitlabRepository(value, base) {
  const url = new URL(value);
  const origin = new URL(`${base}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(origin.pathname)) throw new Error('仓库地址必须属于配置的 GitLab，且不包含凭据');
  return url.toString();
}
