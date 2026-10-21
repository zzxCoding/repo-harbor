import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');
function languageContext(browser = 'en-US', stored = null, blocked = false) {
  const writes = [];
  const context = vm.createContext({ navigator: { language: browser }, localStorage: {
    getItem() { if (blocked) throw new Error('Storage blocked'); return stored; },
    setItem(key, value) { if (blocked) throw new Error('Storage blocked'); writes.push([key, value]); },
  } });
  vm.runInContext(source, context);
  return { i18n: context.RepoHarborI18n, writes };
}
test('language preference overrides browser detection and works without localStorage', () => {
  assert.equal(languageContext('en-GB').i18n.language, 'en');
  assert.equal(languageContext('zh-TW').i18n.language, 'zh-CN');
  assert.equal(languageContext('fr-FR').i18n.language, 'en');
  const { i18n, writes } = languageContext('en-US', 'zh-CN');
  assert.equal(i18n.language, 'zh-CN');
  assert.equal(i18n.setLanguage('en'), true);
  assert.equal(writes[0][0], 'repo-harbor.language'); assert.equal(writes[0][1], 'en');
  assert.equal(i18n.setLanguage('invalid'), false); assert.equal(i18n.language, 'en');
  const disabled = languageContext('zh-CN', null, true).i18n;
  assert.equal(disabled.setLanguage('en'), true); assert.equal(disabled.t('仓库'), 'Repositories');
});
test('English covers initial console/viewer text and retains every interpolation', async () => {
  const { i18n } = languageContext();
  const slots = value => [...new Set([...value.matchAll(/\{(\d+)\}/g)].map(m => m[1]))].sort();
  for (const [key, value] of Object.entries(i18n.messages)) {
    assert(value && !/[\u4e00-\u9fff]/.test(value), `Missing English: ${key}`);
    assert.deepEqual(slots(value), slots(key), `Interpolation mismatch: ${key}`);
  }
  for (const file of ['index.html', 'viewer.html']) {
    const html = await fs.readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    const texts = [...html.matchAll(/>([^<>]+)</g)].map(m => m[1].trim());
    texts.push(...[...html.matchAll(/(?:placeholder|aria-label|title|value)="([^"]+)"/g)].map(m => m[1]));
    for (const text of texts) if (/[\u4e00-\u9fff]/.test(text) && text !== '简体中文') assert(Object.hasOwn(i18n.messages, text), `${file}: ${text}`);
  }
});
test('UI parameters and unknown Git diagnostics stay verbatim in either language', () => {
  const { i18n } = languageContext();
  const path = '已发布/<img src=x onerror=alert(1)>/{0}';
  assert.equal(i18n.tr`当前：${path}`, `Current: ${path}`);
  assert.equal(i18n.t('GitLab HTTP 401：检查 Token 是否有效'), 'GitLab HTTP 401: check that the token is valid');
  assert.equal(i18n.t('符号关系；已用 7 秒'), 'Analyzing symbols; 7s elapsed');
  assert.equal(i18n.t('fatal: original diagnostic 中文'), 'fatal: original diagnostic 中文');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.tr`当前：${path}`, `当前：${path}`);
});
