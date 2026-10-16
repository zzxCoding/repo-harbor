# 参与开发

欢迎通过 Issue 反馈部署问题、语言解析样例或功能建议，通过 Pull Request 提交改进。

## 本地运行

需要 Node.js 24+、Git。安装依赖需要访问 npm，运行时不需要模型服务。

```bash
npm ci
export DATA_DIR="$PWD/.data"
export ADMIN_BOOTSTRAP_PASSWORD="$(openssl rand -hex 24)"
npm start
```

首次密码就是当前终端生成的 `ADMIN_BOOTSTRAP_PASSWORD`；可在同一终端用
`printf '%s\n' "$ADMIN_BOOTSTRAP_PASSWORD"` 查看。已有数据目录不会被该变量重置密码。
默认服务端口为 8093。

## 验证

```bash
npm run check
npm test
bash -n scripts/*.sh deploy/*.sh
```

测试使用临时目录、自建 GitLab API fixture、实际 Git HTTP clone/fetch 和
Codegraph 原生解析器，不连接真实 GitLab。完整测试包含一分钟自动同步、MCP 会话关闭
和撤权过程，通常需数分钟；按文件串行运行，避免原生解析器争用资源。

浏览器检查是可选的独立步骤，需要安装 Playwright 并提供 Chrome：

```bash
npm install --no-save --package-lock=false playwright
MULTI_PROJECT=1 node scripts/ui-fixture.mjs
# 保持 fixture 运行，在另一终端依次执行：
node scripts/ui-check.mjs
node scripts/viewer-ui-check.mjs
node scripts/access-ui-check.mjs
```

也可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright 模块路径。截图和检查结果写入被忽略的
`test/evidence/`；README 截图使用合成仓库，保存在 `docs/screenshots/`。
长时间建图进度截图包含模拟计数，不作为性能测量结果。

## 提交前

- 描述实际问题、修改后行为和运行过的检查；区分本地验证与真实部署。
- 不提交 `.env`、访问令牌、私有源码、快照、索引、备份、日志或镜像归档。
- 权限、源码读取和版本固定的改动，需要补充针对相应边界的测试。
- Codegraph 固定为 3.0.0；升级时验证原生符号图、MCP schema 和查看数据导出。
- 保留 MIT 和上游依赖声明。提交贡献代表同意按项目 MIT 许可证分发该贡献。
