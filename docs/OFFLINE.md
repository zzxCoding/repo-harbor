# RepoHarbor 离线安装

运行目标：Linux x86_64 / AMD64，已安装并启动 Docker Engine 和 Docker Compose v2。
安装阶段不需要 Node.js、Python、npm 或公网，但运行中需要访问已配置的代码托管服务。

## 在联网机器构建

构建机需要 Git、Docker、Python 3.9+；ARM 机器还需可用的 AMD64 仿真。
在 RepoHarbor 源码目录执行：

```bash
./scripts/build-offline.sh
```

也可以选择一个尚不存在的输出目录：

```bash
./scripts/build-offline.sh /tmp/repo-harbor-0.2.1-linux-amd64
```

脚本构建 `repo-harbor:0.2.1-amd64`，导出 Docker 归档，检查归档层、平台和镜像身份，
生成安装包及外部 `.sha256`。已有输出目录不会覆盖；构建失败后可选择新目录重试。
打包步骤不依赖父级仓库或本机历史测试日志。

安装包包含：

```text
images.tar           实际 Docker 镜像
image-audit.json      镜像归档身份和平台检查结果
image-lock.env        加载后允许的镜像身份
SHA256SUMS            包内各文件校验和
compose.yml           离线 Compose，禁止自动拉取镜像
deploy.sh / load.sh    部署、校验和加载
backup.sh             停止应用、备份数据、恢复应用
upgrade.sh            从旧离线部署目录保留配置并升级
source.tar.gz         本版本独立源码
docs/                 使用和运维说明
LICENSE               项目 MIT 许可证
THIRD_PARTY_NOTICES.md 上游声明
```

包内不包含运行 `.env`、真实代码源凭据、数据卷、备份、用户源码、测试日志或
本机 `node_modules`。SHA256 可检查传输损坏，发布者真实性仍取决于获取安装包的渠道。

## 上传并安装

将 `.tar.gz` 和同名 `.sha256` 放在服务器同一目录：

```bash
sha256sum -c repo-harbor-0.2.1-linux-amd64.tar.gz.sha256
tar -xzf repo-harbor-0.2.1-linux-amd64.tar.gz
cd repo-harbor-0.2.1-linux-amd64
./deploy.sh
```

默认打开 `http://服务器IP:8093`。首次管理密码由部署脚本随机生成，显示在命令输出，
同时写入权限为 0600 的 `.env`。首次部署时可用
`PORT=18093 BIND_ADDRESS=127.0.0.1 ./deploy.sh` 更改监听设置。
已有 `.env` 不会被覆盖，重跑脚本保留数据卷。

部署后在页面配置代码源连接、具体仓库地址、分支和同步间隔；地图发布后，
到 AI 接入页创建令牌并选择允许的仓库。服务地址为 `http://服务器IP:8093/mcp`。
管理密码与代码源凭据不提供给 AI 客户端。

## 从 0.2.0、0.1.3 或旧 Code Atlas 离线版本升级

保留旧部署目录与数据卷，把新包解压到其同级目录，旧服务应处于运行状态：

```bash
cd repo-harbor-0.2.1-linux-amd64
./upgrade.sh ../repo-harbor-0.2.0-linux-amd64
```

将参数替换为实际旧目录（也支持旧 code-atlas-0.1.x-linux-amd64 目录）。升级脚本复制原
`.env`，校验新镜像，暂时停止旧应用并备份原数据卷，再用新镜像重建。
备份保存在新目录 `backups/`，不会删除原卷。为兼容旧部署，Compose 项目名
`code-atlas`、服务名 `atlas` 和默认卷名 `code-atlas-data` 保留。

从 0.2.0 升级时仍使用 version=3，无需新的数据迁移。语言偏好保存在浏览器，
可在登录页、控制台和地图页切换。

旧 version=1 / version=2 配置迁移为 version=3。原 GitLab 连接自动成为独立代码源，
仓库 ID、源码快照、发布 commit、管理密码、AI 令牌值和权限清单保留。新版页面可继续
添加 GitHub 或通用 Git 连接；新增仓库不会自动加入旧令牌权限。客户端在升级后重新连接。

**回退到 0.1.3 或更早版本，必须恢复升级前备份到新卷；不能只换旧镜像继续使用
已经迁移的 version=3 数据。** 备份、恢复、日志和代理见 [运维说明](OPERATIONS.md)。

## 日常命令

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 -f atlas
./backup.sh
```

备份包含解密密钥和源码，请妥善保存。不要执行 `docker compose down -v`。
当前不自动清理旧源码快照和索引，需要监测磁盘空间。
