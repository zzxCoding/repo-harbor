# MCP 工具与版本行为

RepoHarbor 在 `/mcp` 提供 Streamable HTTP，使用
`Authorization: Bearer <AI 读取令牌>`。不支持仅有旧式 SSE transport 的客户端。
端口、TLS 和反向代理与管理页面共用。

## 19 个只读工具

| 工具 | 用途 |
| --- | --- |
| `list_repos` | 列出当前令牌获准且启用的仓库、发布版本及会话固定版本 |
| `search` | 确定性排序的文件、符号、代码片段及图上下文检索 |
| `workspace_symbols` | 按符号身份、名称和过滤条件定位符号 |
| `orient` | 获取仓库方向性上下文 |
| `explore` | 结合检索与排名靠前结果的上下文 |
| `packet_get` | 按文件、符号或目标读取有大小限制的证据包 |
| `get_file` | 按相对路径和行号分页读取源码 |
| `get_symbol` | 解析稳定的符号或检索 handle |
| `goto` | 按 handle、限定名或文件位置查定义 |
| `refs` | 查符号引用 |
| `calls` | 查已解析的调用方、被调用方及调用位置 |
| `file_deps` | 查文件依赖或反向依赖 |
| `path` | 查两个文件间最短依赖路径 |
| `type_hierarchy` | 查已提取的继承和实现关系 |
| `implementations` | 查类型或支持的接口成员实现 |
| `rename_preview` | 只读查看重命名可能影响，不修改文件 |
| `refactor_plan` | 只读整理重构证据，不执行重构 |
| `impact` | 上游提供的 Git 范围影响上下文，受下述快照限制 |
| `review` | 上游提供的 Git 范围审查上下文，受下述快照限制 |

除 `list_repos` 外，工具 schema 来自固定版本的 Codegraph，再增加 `repo` 参数。
请以客户端实际 `tools/list` 返回的参数为准。源码快照不包含 `.git`，因此不要把
`impact` / `review` 当作本服务的跨 commit diff 接口；依赖 Git 历史的参数不保证可用，
MR、diff 和未发布提交应继续使用 GitLab。这里也不提供通过 `ref`、`branch` 参数任意
切换快照的能力。

以下上游工具被明确关闭：`refresh_index`、`artifact_build`、`query_sqlite`。
同步、分支与建图均由管理员页面管理，AI 无写入操作。

## 一次可靠查询

```json
{"name":"list_repos","arguments":{}}
{"name":"search","arguments":{"repo":"<仓库id>","query":"calculatePrice"}}
{"name":"get_file","arguments":{"repo":"<仓库id>","file":"src/pricing.ts","offset":1,"limit":80}}
```

检索结果提供 handle 时，复制返回的 handle 给 `calls`、`refs` 或 `get_symbol`，
不要自行拼接。`get_file.offset` 是从 1 开始的行号。`repo` 可以是获准仓库 ID，
也可以是准确的 GitLab 项目路径；仅在获准且启用的仓库只有一个时可省略。

可以给 AI 加入这样的使用约束：先列仓库和确认版本，用代码词定位，再追踪关系、读取
源码；区分代码观察和推断，回答中提供文件、行号和 commit。关系未被提取不代表业务
运行中没有该关系，尤其注意反射、动态派发和框架配置。

## 令牌权限

权限在服务端针对所有地图和源码工具检查，不依赖提示词约束：

- 仓库必须在当前令牌明确保存的 ID 清单里，而且仍启用。
- 不会向 `list_repos` 返回其他仓库；猜路径或 ID 也无法读取。
- MCP session 绑定令牌 ID 和权限 revision，不能换令牌复用其他客户端的会话。
- 修改范围、启停、轮换和删除令牌会关闭该令牌会话；在途读取返回前再次检查权限。
- 新增仓库和删除后重新添加同一路径的仓库不会自动扩大已有权限。
- 新令牌至少选择一个仓库；编辑时允许清空范围，此时该令牌不能读取任何仓库。
- 最多 64 个读取令牌，不会自动同步最终用户的 GitLab ACL。

## 发布版本和会话

后台先建立不可变 commit 快照，再预热完整索引、生成浏览器查看数据，通过查询探针
后发布。更新期间旧地图继续提供查询；同步或建图失败保留旧版本。

MCP 会话第一次查询某个仓库时固定当时的发布版本，后续图和源码使用相同快照。
`list_repos` 中的 `commit` 是当前发布版本，`sessionCommit` 是该会话已固定的版本。
工具结果会附带 repository 元数据，包括 `branch`、`commit`、`indexedAt`。
要读取新版本，需要重新连接 MCP。

最多 32 个 MCP 会话，闲置 30 分钟回收；全实例同时最多 16 个工具查询。
单个查询最多等待 5 分钟。客户端可能有更短的请求超时，需按其配置调整。

## 常见响应

| 响应 | 处理 |
| --- | --- |
| HTTP 401 | 检查读取令牌是否正确、启用、已轮换或已删除 |
| HTTP 404 / session expired | 会话已过期或权限变更，重新 initialize / 连接 |
| HTTP 400 / initialize required | 通过 MCP 客户端先握手，不要直接把工具请求发到新会话 |
| HTTP 403 | 检查代理是否保留原始 Host、Origin 和协议头 |
| HTTP 429 | 会话已满，关闭闲置客户端或稍后重试 |
| 仓库不可用或未授权 | 在 AI 接入页检查仓库勾选和仓库启用状态 |
| 尚未发布代码地图 | 等待首次建图；在仓库详情查看进度或失败原因 |
| 查询繁忙 | 实例并发上限已到，稍后重试 |

对 `/mcp` 执行普通 GET 不能证明握手、工具权限和读源码均正常。
诊断时应使用真实 MCP 客户端完成 initialize → list_repos → search → get_file。
