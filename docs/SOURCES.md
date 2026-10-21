# 代码源连接

0.2.0 支持 GitLab、GitHub（含 Enterprise Server）和通用 HTTP(S) Git。
一个实例最多保存 32 组连接；同一平台可配置多个服务器或不同读取账号。
在“代码源 → 添加连接”填写名称、平台和服务首页，再在“添加仓库”中选择对应连接。

## 平台配置

| 类型 | 服务首页示例 | 认证与仓库地址 |
| --- | --- | --- |
| GitLab | `https://gitlab.example.internal` 或 `https://host/gitlab` | Token 需 `read_api`、`read_repository` 和目标项目权限；输入完整克隆地址、项目路径或 SSH 形式的项目地址 |
| GitHub | `https://github.com` | PAT 选择需要同步的仓库并授予 Contents 读取；输入完整克隆地址或 `owner/repository` |
| GitHub Enterprise Server | `https://github.example.internal` | 仍选择 GitHub；自动使用同源 `/api/v3`，填企业实例自己的 PAT |
| 通用 Git | `https://git.example.internal`，也可包含服务器路径前缀 | 填完整 HTTP(S) 仓库地址；无需平台 API，使用标准 Git 读取分支和同步 |

GitHub 和通用 Git 可选择“无需认证”以读取公开仓库。私有通用 Git 填该平台所需的
实际 Git 用户名及密码 / Token。各连接均可配置 PEM 格式内部 CA。
当前不支持 SSH key、OAuth 登录、GitHub App 令牌自动刷新、客户端双向 TLS 或自动
继承最终 AI 用户在托管平台上的权限。

GitHub.com 的 API 地址自动设为 `https://api.github.com`；Enterprise Server 的 API
来自配置首页的 `/api/v3`，不是任意第三方 API 代理。GitHub Enterprise Cloud 专用
`ghe.com` 域名的 API 域名映射未单独适配，可优先使用通用 Git。

GitLab / GitHub 的“测试连接”检查 API 凭据，不能代替具体仓库的读取权限和 Git 同步
验证。通用 Git 保存时只检查参数格式；在添加仓库时进行真实 `git ls-remote`，识别
默认分支、列出远端分支并验证 Git 读取权限。如果无法识别默认分支，需显式填写分支。
空仓库没有可同步分支，不能发布代码地图。

平台权限参考：[GitLab PAT](https://docs.gitlab.com/user/profile/personal_access_tokens/)、
[GitHub 仓库信息](https://docs.github.com/en/rest/repos/repos#get-a-repository)、
[GitHub 分支 / Contents 读取](https://docs.github.com/en/rest/branches/branches#list-branches)、
[Git ls-remote](https://git-scm.com/docs/git-ls-remote)。

## 修改与移除连接

- 名称、用户名、密码 / Token、无需认证模式和 CA 可编辑。密码字段留空保留原凭据；
  选择无需认证会移除该连接正在使用的秘密值。
- 连接有仓库绑定时，平台和服务地址不可改，连接也不可移除。先移除相应仓库配置
  才能操作；磁盘快照仍保留。暂停仓库仍算绑定。
- 同步任务使用开始时的连接版本；连接在任务中途改变时，本轮结果不会发布，后续
  重新安排同步。其他代码源使用自己的凭据。
- 仓库 URL 必须属于所选连接的源和路径前缀；HTTP 跳转不会携带凭据继续同步。
  GitHub API 分页也不能跳到其他源。

## 同名仓库与 MCP

不同连接可以同时包含 `team/service`，即使 GitLab 与 GitHub 都返回相同数字项目 ID，
也不会合并。页面仓库列表与读取令牌授权选项会显示所属连接。

`list_repos` 每个条目包含服务分配的仓库 UUID，以及 `source` 连接元数据。
推荐始终把 UUID 传给地图和源码工具。如果路径对应多个当前令牌获准的仓库，服务会
拒绝歧义请求，要求使用 UUID。Token 按仓库 UUID 授权，新增连接或新仓库不会自动
扩大旧令牌范围。

## 迁移

0.1.3 的 version=2 配置，以及更早的 version=1，启动时迁移到 version=3。
原单 GitLab 连接成为“原有 GitLab 连接”，旧仓库自动绑定它。仓库 UUID、缓存和快照
路径、发布 commit、管理密码哈希、读取令牌密文及权限保持不变。
迁移前保留完整数据卷备份；回退到 0.1.3 或更早版本必须恢复旧备份到新卷。
