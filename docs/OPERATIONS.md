# 运维、升级与故障排查

以下 Compose 命令在源码部署根目录或离线包解压目录执行。
服务名仍为 `atlas`；在同机多实例场景中，始终使用各实例自己的 `.env`。

## 数据与配置

| 项目 | 默认值 / 行为 |
| --- | --- |
| 监听 | `0.0.0.0:8093`，可在 `.env` 修改 `BIND_ADDRESS` / `PORT` |
| Compose 项目 | `code-atlas`，沿用早期部署；可通过 `.env` 的 `COMPOSE_PROJECT_NAME` 覆盖 |
| 数据卷 | `code-atlas-data`，可在 `.env` 修改 `DATA_VOLUME` |
| 容器内数据 | `/data`；包含配置、密钥、Git 镜像、源码快照和索引 |
| 首次密码 | `.env` 的 `ADMIN_BOOTSTRAP_PASSWORD`，仅用于初始化空数据目录 |
| 同步间隔 | 页面设置，默认 15 分钟，范围 1–1440 分钟 |
| 完整建图上限 | 页面设置，默认 120 分钟，范围 5–360 分钟 |

多实例要为每个实例设置不同的 `COMPOSE_PROJECT_NAME`、`PORT`、`DATA_VOLUME`；
不能只换端口。默认配置是一个实例，数据卷名称是显式指定的，不会随项目名自动变化。

管理密码哈希、代码源凭据密文、读取令牌密文和 master key 均在持久化目录中。
密钥与密文同时保存在数据卷，磁盘访问者可取得解密所需材料；加密存储不能代替文件
权限和备份保护。丢失 key 时服务不会生成新 key 覆盖已有配置。

## 健康、日志和性能观察

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 -f atlas
docker stats --no-stream "$(docker compose --env-file .env -f compose.yml ps -q atlas)"
docker top "$(docker compose --env-file .env -f compose.yml ps -q atlas)" -eo pid,ppid,etime,time,pcpu,pmem,args
curl --fail http://127.0.0.1:8093/healthz
```

`/healthz` 只证明进程存活，不代表仓库已经建图成功。查看页面发布 commit，
再用 MCP 查询验证。容器日志配置为每份 10 MiB、最多 3 份。
建图阶段每 15 秒或阶段变化时输出进度；文件计数只属于文件索引阶段。
完整建图之后还会进行依赖、符号关系和验证。

同步任务串行执行。大型仓库首次建图可能持续较久；记录源码规模、文件类型、各阶段
耗时和 CPU 后再判断瓶颈，不把某个合成样本时间当作真实仓库性能承诺。
容器重启后会恢复已发布索引，首次准备期间查询可能需要等待。

## 备份

离线包直接运行 `./backup.sh`，会短暂停止应用，备份后恢复运行。
源码部署可用下列命令，同样确保配置和索引处于一致状态：

```bash
(
  set -euo pipefail
  umask 077
  mkdir -p backups
  container=$(docker compose --env-file .env -f compose.yml ps -q atlas)
  test -n "$container"
  volume=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
  image=$(docker inspect "$container" --format '{{.Image}}')
  test -n "$volume"
  file="backups/repo-harbor-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  docker compose --env-file .env -f compose.yml stop atlas
  trap 'docker compose --env-file .env -f compose.yml start atlas' EXIT
  docker run --rm --platform linux/amd64 --network none --read-only \
    --entrypoint tar -v "$volume":/data:ro "$image" czf - -C /data . > "$file"
  printf '备份已保存：%s\n' "$file"
)
```

另行安全保存 `.env`、当前源码 commit 或安装包、镜像 tag/ID。
备份包含源码和解密密钥，不要提交 Git、发到公开 Issue 或放入公开静态目录。

## 恢复到新卷

先停止待恢复的应用。保留旧数据卷，在一个**尚不存在的新卷**中恢复：

```bash
docker volume create repo-harbor-restored-data
docker run --rm --platform linux/amd64 --user 0 --network none --read-only \
  --entrypoint tar \
  -v repo-harbor-restored-data:/data \
  -v "$PWD/backups":/backup:ro \
  repo-harbor:0.2.1-amd64 \
  xzf /backup/替换为实际备份文件名.tar.gz -C /data
```

将 `.env` 中 `DATA_VOLUME` 改为恢复卷名，再按部署方式启动。
确认原管理密码、代码源连接、令牌权限、发布 commit 和实际 MCP 读源码正常，
期间保留原卷。`docker volume create` 不会拒绝已经存在的卷，执行前应确认新卷名
尚未被使用，避免把备份解入旧数据。

## 升级与回退

源码部署：先备份，然后 `git pull --ff-only` 并执行 `./scripts/start.sh`。
脚本重新构建镜像并重建容器，保留 `.env` 和数据卷。若有本地修改，先处理 Git 状态，
不要强制覆盖。离线部署的升级路径见 [OFFLINE.md](OFFLINE.md)。

旧 Code Atlas 0.1.0–0.1.2 的 version=1、0.1.3 的 version=2 配置会迁移到 version=3。
原有单 GitLab 连接变为一条独立连接，各仓库自动绑定它。仓库 ID、发布快照、管理密码和
读取令牌值与权限清单保留；新增代码源或仓库不会自动扩大旧令牌范围。

回退需同时匹配应用和数据格式。**version=3 数据不能直接交给 0.1.3 或更早的旧应用。**
使用旧安装包/镜像，将升级前备份恢复到新卷，并让旧应用连接新卷。保留升级后的卷，
避免丢失升级后的操作。回退后的读取令牌值、权限和连接配置以备份时刻为准。

## 域名与 HTTPS 反向代理

内网 IP 可直接访问，域名可选。跨主机使用时建议 HTTPS。
下面的 Nginx 示例放在已有 TLS 站点的 `server` 内，应用部署在域名根路径：

```nginx
location / {
    proxy_pass http://127.0.0.1:8093;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 360s;
    proxy_send_timeout 360s;
}
```

该片段不包含域名、证书和 TLS 监听配置，需要由现有网关提供。
使用代理时可将应用绑定 `127.0.0.1`；保留原始 Host、Origin、Authorization 和 MCP
会话/协议相关请求头，不能让代理剥离这些字段。不要把服务简单挂到 `/atlas/` 之类的
子路径：当前页面使用从 `/` 开始的资源和 API 路径，前缀部署不受支持。

页面和 MCP 应使用同一个对外地址，例如 `https://code.example.internal/` 与
`https://code.example.internal/mcp`。AI 客户端所在主机需能解析和访问该地址；
使用企业 CA 时客户端也需要信任相应证书。

## 故障排查

| 现象 | 检查方向 |
| --- | --- |
| GitLab / GitHub 测试返回 401 | Token 值、是否过期、是否撤销 |
| GitHub 返回 403 / 404 | 仓库选择、Contents 读取、组织批准 / SSO 授权、API 速率限制 |
| 通用 Git 保存后添加失败 | 检查实际仓库地址、Git 用户名与密码 / Token，保存连接本身不验证仓库读取权 |
| 多个代码源存在同名仓库 | 依据连接名称区分，MCP 使用 list_repos 返回的仓库 ID |
| GitLab 返回 403 / 404 | `read_api`、`read_repository`、项目成员权限、地址和子路径 |
| TLS 证书校验失败 | 管理页面中填企业 CA 的 PEM 证书，确认域名与证书匹配 |
| 文件索引 100% 仍未发布 | 继续观察符号关系和验证阶段，这是完整建图的一部分 |
| 建图达到时间上限 | 确认进度仍推进后，在管理设置增加上限，从下次建图生效 |
| 新同步失败但 AI 还能读 | 仍在服务上一个已发布版本；比对结果中的 commit |
| 新版本已发布但 AI 仍读旧代码 | 重新连接 MCP；已打开的网页地图也重新打开 |
| AI 仓库列表为空 | 令牌是否勾选对应仓库、仓库是否启用；随后确认是否已发布 |
| 权限修改后会话不可用 | 预期行为，重新连接；其他令牌会话不受影响 |
| 代理访问 403 | 保留原始 Host 和 Origin，检查是否经过了前缀路径重写 |
| 内存或磁盘持续增长 | 监测 Codegraph reader、仓库数和快照数量；当前无自动快照清理 |
| 改首次密码变量仍无法登录 | 该变量不重置已有数据；使用页面修改后的管理密码 |

暂停仓库会停止新任务和 AI 访问；移除配置也会撤销访问，但不会自动删除磁盘快照。
不要通过直接删除 `/data`、密钥或索引文件来恢复登录或释放空间。
