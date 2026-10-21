/* Shared by the console and map viewer. Repository content is never translated. */
(() => {
  const messages = {
    '界面语言': 'Language',
    'RepoHarbor · 代码地图': 'RepoHarbor · Code maps',
    'RepoHarbor · 码港': 'RepoHarbor',
    '让代码有迹可循': 'Find your way through code',
    '连接仓库，建立地图。': 'Connect repositories. Build code maps.',
    '让 AI 沿着调用关系找到真实源码。': 'Let AI follow call relationships to the source.',
    '代码仓库': 'Repositories', '代码地图': 'Code maps',
    '登录仓库控制台': 'Sign in to the repository console',
    '使用部署时生成的管理密码。': 'Use the admin password generated during deployment.',
    '管理密码': 'Admin password', '登录': 'Sign in',
    '首次密码显示在部署命令的输出中。登录后可在管理设置里修改。': 'The initial password appears in the deployment output. Change it in Settings after signing in.',
    '代码地图 · 仓库控制台': 'Code maps · Repository console',
    '主导航': 'Main navigation', '仓库': 'Repositories', '代码源': 'Sources', 'AI 接入': 'AI access', '管理设置': 'Settings',
    '尚未配置代码源': 'No sources configured', '退出登录': 'Sign out',
    '工作区 / 仓库': 'Workspace / Repositories', '工作区 / {0}': 'Workspace / {0}',
    '正在读取状态': 'Loading status',
    '管理同步范围，查看 AI 当前读取的代码版本。': 'Choose what to sync and see which code version AI can read.',
    '添加仓库': 'Add repository', '先添加代码源连接，再选择需要建立地图的仓库。': 'Add a source connection, then choose repositories to map.',
    '配置连接': 'Configure a source', '暂无仓库': 'No repositories yet', '同步全部': 'Sync all',
    '添加第一个仓库': 'Add your first repository', '选择代码源，填写仓库地址和分支。': 'Choose a source, repository URL and branch.',
    '首次同步和建图完成后，AI 即可查询。': 'AI can query the repository after its first sync and map build.',
    '仓库 / 分支': 'Repository / Branch', '状态': 'Status', '已发布版本': 'Published version', '最近成功同步': 'Last successful sync', '操作': 'Actions',
    '新版本建图成功后才发布。同步失败时，已发布版本继续可用。': 'A new version is published after its map is ready. The published version remains available if a sync fails.',
    '连接不同的托管平台。每个仓库使用所属连接的读取凭据。': 'Connect hosting platforms. Each repository uses its own source connection’s credentials.',
    '添加连接': 'Add connection', '添加代码源连接': 'Add a source connection',
    '支持 GitLab、GitHub 和通用 HTTP(S) Git。': 'Supports GitLab, GitHub and generic HTTP(S) Git.',
    '可以同时连接多个平台或不同的服务器。': 'Connect multiple platforms or servers at the same time.',
    '添加第一个连接': 'Add your first connection',
    '凭据独立加密保存，不会提供给 AI 客户端。已有仓库的连接不能直接更换平台或地址。': 'Credentials are encrypted separately and kept out of AI clients. A connection’s platform and URL are locked while repositories are attached.',
    '为不同客户端创建读取令牌，分别选择可访问的仓库。': 'Create a read token for each client and choose the repositories it can access.',
    '创建读取令牌': 'Create read token', 'MCP 地址': 'MCP URL', '复制地址': 'Copy URL',
    '所有令牌使用同一个 MCP 地址。后台按令牌限制仓库列表、地图查询和源码读取。': 'All tokens use the same MCP URL. Each token limits repository discovery, map queries and source reads.',
    '读取令牌': 'Read tokens', '还没有读取令牌。创建时选择允许访问的仓库，再配置到 AI 客户端。': 'No read tokens yet. Create one, select its repositories, then configure your AI client.',
    '接入信息': 'Connection details', 'AI 读取令牌': 'AI read token', '点击查看令牌': 'Click to reveal token', '查看': 'Reveal', '隐藏': 'Hide', '复制': 'Copy',
    '该令牌只能读取上方授权且已启用的仓库，不具备管理或修改源码的权限。': 'This token can only read the enabled repositories granted above. It cannot manage repositories or change source code.',
    '地图与源码保持在同一版本': 'Maps and source stay on the same version',
    '一个 AI 会话首次查询仓库时固定其发布版本。重新连接 MCP 后，可读取新的发布版本。': 'An AI session pins each repository to its published version on the first query. Reconnect MCP to read a newer published version.',
    '客户端配置示例': 'Example client configuration',
    '具体字段以客户端的 MCP 配置格式为准。先调用 list_repos，再把仓库 id 传入 repo。': 'Adapt the fields to your client’s MCP format. Call list_repos first, then pass a repository id as repo.',
    '重新生成令牌': 'Regenerate token', 'Bearer <AI 读取令牌>': 'Bearer <AI_READ_TOKEN>',
    '设置自动同步频率和控制台登录密码。': 'Set the sync interval and console password.',
    '自动同步': 'Automatic sync', '同步间隔（分钟）': 'Sync interval (minutes)',
    '依次同步已启用仓库；代码没有变化时跳过建图。也可在仓库页立即同步。': 'Sync enabled repositories in sequence. Unchanged code skips rebuilding. You can also sync from the repository page.',
    '保存同步间隔': 'Save sync interval', '单次建图超时（分钟）': 'Map build timeout (minutes)',
    '首次完整建图可能耗时较长。默认 120 分钟，可设置 5–360 分钟；保存后从下次建图生效。详情页会显示文件索引进度和当前阶段和总耗时。': 'The first full build can take time. The default is 120 minutes; choose 5–360 minutes. Changes apply to the next build. Repository details show file progress, the current stage and elapsed time.',
    '保存建图设置': 'Save build settings', '修改管理密码': 'Change admin password', '当前密码': 'Current password', '新密码': 'New password', '再次输入新密码': 'Confirm new password',
    '至少 12 个字符。修改后所有管理会话退出，AI 读取令牌不变。': 'Use at least 12 characters. Changing the password signs out all admin sessions. AI read tokens stay valid.',
    '修改密码': 'Change password', '关闭': 'Close', '连接名称': 'Connection name',
    '例如：团队 GitLab、开源项目 GitHub': 'e.g. Team GitLab, Open-source GitHub',
    '托管平台': 'Hosting platform', '通用 Git（HTTP / HTTPS）': 'Generic Git (HTTP / HTTPS)', '服务首页地址': 'Service base URL',
    '该连接已有仓库。平台和地址暂不可修改；可以更新名称、读取凭据或 CA 证书。': 'Repositories are attached to this connection. You can update its name, credentials and CA certificate; the platform and URL are locked.',
    '无需认证（公开仓库）': 'No authentication (public repositories)', 'Git 用户名': 'Git username', '密码 / 访问令牌': 'Password / Access token',
    '内部 CA 证书': 'Internal CA certificate', 'CA 证书（可选）': 'CA certificate (optional)',
    '验证该连接的 HTTPS 证书，不关闭 TLS 校验。': 'Use this CA to verify the connection’s HTTPS certificate. TLS verification stays enabled.',
    '测试连接': 'Test connection', '保存连接': 'Save connection', '保存后自动开始首次同步和建图。': 'The first sync and map build start automatically after saving.',
    '代码源连接': 'Source connection', '仓库地址': 'Repository URL', '同步分支（可选）': 'Sync branch (optional)', '留空使用项目默认分支': 'Leave blank to use the default branch',
    '取消': 'Cancel', '添加并同步': 'Add and sync', '仓库详情': 'Repository details', '文件索引进度': 'File indexing progress',
    'AI 当前读取': 'Version available to AI', '尚未发布': 'Not published', '发布时间': 'Published at', '下次自动同步': 'Next automatic sync', '同步分支': 'Sync branch',
    '保存并同步': 'Save and sync', '查看地图': 'Open map', '立即同步': 'Sync now', '暂停同步': 'Pause sync', '移除配置': 'Remove configuration', '任务记录': 'Task history',
    '移除配置会停止 AI 访问；已下载的快照保留在数据卷中。': 'Removing the configuration stops AI access. Downloaded snapshots remain in the data volume.',
    '确认操作': 'Confirm action', '确认': 'Confirm', '令牌名称': 'Token name', '例如：订单服务助手': 'e.g. Order service assistant', '允许访问的仓库': 'Allowed repositories', '搜索仓库路径': 'Search repository paths',
    '只开放勾选的仓库。新增仓库不会自动授权；暂停的仓库暂不可读取。编辑时清空选择可停止所有仓库访问。': 'Only selected repositories are granted. New repositories are not added automatically, and paused repositories cannot be read. Clear all selections while editing to revoke all repository access.',
    '启用此令牌': 'Enable this token', '保存权限后，该令牌的已有 MCP 会话会关闭，客户端需重新连接。其他令牌不受影响。': 'Saving permissions closes this token’s existing MCP sessions. Its client must reconnect. Other tokens are unaffected.',
    '创建令牌': 'Create token',
    '已发布': 'Published', '等待同步': 'Queued', '拉取代码': 'Fetching code', '建立地图': 'Building map', '恢复查询': 'Restoring queries', '同步失败': 'Sync failed', '已暂停': 'Paused',
    '启动解析器': 'Starting parser', '扫描文件': 'Discovering files', '文件索引': 'Indexing files', '符号关系': 'Analyzing symbols', '生成查看地图': 'Preparing map viewer', '地图就绪': 'Map ready', '验证地图': 'Validating map', '建图失败': 'Map build failed',
    ' {0} / {1} 文件（{2}%）': ' {0} / {1} files ({2}%)',
    '{0}{1} · 已用 {2} 分 {3} 秒 · 上限 {4} 分钟': '{0}{1} · {2}m {3}s elapsed · {4} min limit',
    '请求失败（{0}）': 'Request failed ({0})', '{0} 个仓库，{1} 个已发布': 'Repositories: {0} · Published: {1}', '已配置 {0} 个代码源': 'Configured sources: {0}',
    '正在同步，另有 {0} 个等待': 'Syncing; {0} more queued', '{0} 个任务等待同步': 'Queued sync tasks: {0}', '自动同步已就绪': 'Automatic sync ready',
    '仍可读取上次发布版本': 'Previous version remains available', '当前：{0}': 'Current: {0}', '同步': 'Sync', '详情': 'Details', '已复制': 'Copied', '浏览器不允许复制，请手工选择内容': 'Copying is unavailable. Select and copy the content manually.',
    '通用 Git': 'Generic Git', '已移除仓库': 'Removed repository', '无需认证': 'No authentication', '已保存读取凭据': 'Read credentials saved', '{0} 个仓库 · {1}': 'Repositories: {0} · {1}',
    '编辑连接': 'Edit connection', '移除连接': 'Remove connection', '请先移除该连接的仓库配置': 'Remove the attached repository configurations first',
    '填写 github.com 或 GitHub Enterprise Server 首页；不填写 api.github.com。': 'Enter github.com or your GitHub Enterprise Server base URL, rather than api.github.com.',
    '填写仓库所在服务首页，可包含路径前缀。仓库地址必须属于该连接。': 'Enter the hosting service’s base URL, including any path prefix. Repository URLs must belong to this connection.',
    '需要 read_api、read_repository 和项目读取权限。': 'Requires read_api, read_repository and access to the project.',
    '个人访问令牌需允许所选仓库的 Contents 读取；组织可能需要批准或 SSO 授权。': 'The personal access token needs Contents read access to the selected repositories. Organization approval or SSO authorization may also be required.',
    '私有仓库填写实际 Git 用户名与密码 / Token；添加仓库时验证读取权限。': 'For private repositories, enter the Git username and password / token. Read access is checked when adding a repository.',
    '仅访问无需认证的公开仓库。': 'Only public repositories without authentication are accessible.', '留空保留当前凭据。': 'Leave blank to keep the current credentials. ',
    '通用 Git 在添加具体仓库时通过实际 Git 握手验证。': 'Generic Git connections are verified through a real Git handshake when adding a repository.',
    '编辑代码源连接': 'Edit source connection', '移除代码源连接': 'Remove source connection',
    '移除 {0} 的连接与读取凭据。已下载的快照不会删除。': 'Remove the connection and read credentials for {0}. Downloaded snapshots will remain.', '连接已移除': 'Connection removed',
    '请选择代码源连接': 'Select a source connection', '填写完整 HTTP(S) 仓库地址；读取权限将在添加时验证。': 'Enter the full HTTP(S) repository URL. Read access is checked when you add it.',
    '支持完整仓库地址、owner/repository 或 git@host:path.git；实际使用 HTTP(S) 同步。': 'Accepts a full URL, owner/repository or git@host:path.git. Code is synced over HTTP(S).',
    '请先添加代码源连接': 'Add a source connection first', '请选择连接': 'Select a connection',
    '文件索引已完成，正在分析符号与调用关系。该阶段不提供文件百分比。': 'Files are indexed. Symbol and call analysis is in progress; this stage has no file percentage.',
    '百分比仅表示文件索引进度；完整符号关系和地图验证完成后才发布。': 'The percentage only covers file indexing. Publication follows complete symbol analysis and map validation.',
    '启用并同步': 'Enable and sync', '查看当前发布版本的地图与源码': 'View the published map and source', '首次建图成功后可查看': 'Available after the first successful map build', '等待首次同步。': 'Waiting for the first sync.',
    '已安排 {0} 个同步任务': 'Sync tasks scheduled: {0}', '所选仓库正在同步或已有任务等待': 'The selected repositories are already syncing or queued',
    '代码源连接已保存': 'Source connection saved', '正在测试…': 'Testing…', '连接成功：{0}': 'Connected: {0}', '公开仓库（无需认证）': 'Public repositories (no authentication)',
    '仓库已添加，开始首次同步': 'Repository added; first sync started', '此仓库已存在，可在详情中修改分支': 'This repository already exists. Change its branch in repository details.',
    '分支已保存，将同步新版本': 'Branch saved; the new version will be synced', '已暂停同步及 AI 访问': 'Sync and AI access paused', '已启用仓库': 'Repository enabled',
    '移除仓库配置': 'Remove repository configuration', '移除 {0} 后，AI 无法继续访问此仓库。已下载的快照和索引会保留。': 'AI will lose access to {0}. Downloaded snapshots and indexes will remain.', '仓库配置已移除': 'Repository configuration removed',
    '{0} 个令牌': 'Tokens: {0}', '请先在仓库页添加仓库，再创建读取令牌。': 'Add a repository first, then create a read token.', '已启用': 'Enabled', '已停用': 'Disabled', '没有授权仓库': 'No repositories granted',
    '编辑权限': 'Edit permissions', '停用': 'Disable', '启用': 'Enable', '删除': 'Delete', '{0} · 接入信息': '{0} · Connection details', '允许仓库：{0}': 'Allowed repositories: {0}', '无': 'None',
    '已选择 {0} 个仓库': 'Selected repositories: {0}', '（已暂停）': ' (paused)', '编辑读取权限': 'Edit read permissions', '保存权限': 'Save permissions',
    '令牌已停用，已有会话已关闭': 'Token disabled; existing sessions closed', '令牌已启用': 'Token enabled', '删除读取令牌': 'Delete read token',
    '删除“{0}”后，该客户端不能继续访问地图和源码。仓库配置与数据保留。': 'Deleting “{0}” stops this client’s access to maps and source. Repository configurations and data will remain.',
    '删除令牌': 'Delete token', '读取令牌已删除': 'Read token deleted', '读取权限已保存，该令牌的客户端需重新连接': 'Read permissions saved. This token’s client must reconnect.',
    '读取令牌已创建，点击查看或复制后配置到客户端': 'Read token created. Reveal or copy it to configure your client.',
    '请先选择一个已启用的读取令牌': 'Select an enabled read token first', '令牌选择已变化，请重新选择': 'The token selection changed. Select it again.',
    '重新生成读取令牌': 'Regenerate read token', '此令牌的旧值会立即失效，对应 AI 会话将关闭。授权仓库保持原选择，其他令牌不受影响。': 'The old token value stops working immediately and its AI sessions close. Repository grants stay the same. Other tokens are unaffected.',
    '重新生成': 'Regenerate', '新令牌已生成，请重新复制并更新该客户端': 'New token generated. Copy it and update this client.', '同步间隔已保存': 'Sync interval saved', '建图超时已保存，下次建图生效': 'Build timeout saved; applies to the next build',
    '两次输入的新密码不一致': 'The new passwords do not match', '密码已修改，请重新登录': 'Password changed. Sign in again.',
    '仓库地图 · RepoHarbor': 'Repository map · RepoHarbor', '返回仓库': 'Back to repositories', '仓库地图': 'Repository map', '正在读取已发布版本': 'Loading published version',
    '正在载入地图…': 'Loading map…', '索引文件': 'Indexed files', '搜索文件路径': 'Search file paths', '搜索文件路径…': 'Search file paths…',
    '代码关系图': 'Code relationships', '地图类型': 'Map type', '文件依赖': 'File dependencies', '文件内符号': 'Symbols in file', '放大地图': 'Zoom in', '缩小地图': 'Zoom out', '适应画面': 'Fit to view', '全库概览': 'Repository overview',
    '文件': 'Files', '当前选中': 'Selected', '符号 · 点击节点查看，滚轮缩放': 'Symbols · Click a node to inspect; scroll to zoom',
    '当前浏览器无法绘制关系图。仍可使用文件搜索、依赖列表和源码预览。': 'Graph rendering is unavailable in this browser. File search, dependencies and source preview are still available.',
    '选择一个文件': 'Select a file', '依赖关系': 'Dependencies', '依赖这些文件': 'Depends on', '被这些文件依赖': 'Used by', '符号': 'Symbols',
    '搜索当前文件的符号': 'Search symbols in this file', '搜索当前文件的符号…': 'Search symbols in this file…', '复制当前页': 'Copy this page', '源码预览': 'Source preview', '上一页': 'Previous', '下一页': 'Next',
    '从左侧搜索文件，或点击图中的节点。源码与地图固定在顶部所示 commit。': 'Search for a file or click a graph node. Source and map are pinned to the commit shown above.',
    '登录已过期，请返回仓库重新登录。': 'Your session expired. Return to repositories and sign in again.', '读取地图失败': 'Could not load the map',
    '{0} 个匹配文件{1}': 'Matching files: {0}{1}', '，先显示 160 个，可继续输入缩小范围': '; showing the first 160. Type more to narrow the results',
    '全库概览：显示 {0} / {1} 个文件，优先展示关联较多的文件。搜索或点击文件查看局部关系。': 'Overview: {0} / {1} files, prioritizing highly connected files. Search or select a file to explore its neighbors.',
    '当前文件与直接依赖：显示 {0} / {1} 个文件。连线方向见右侧依赖列表。': 'Selected file and direct dependencies: {0} / {1}. See the dependency lists for direction.',
    ' 连线最多显示 {0} 条。': ' Up to {0} edges are shown.', '{0} · 第 {1} 行': '{0} · Line {1}',
    '当前文件的定义与文件内引用关系：显示 {0} / {1} 个符号。跨文件关系请查看“文件依赖”。': 'Definitions and references in this file: {0} / {1} symbols. Use File dependencies for relationships between files.',
    '无已解析的关系': 'No resolved relationships', '另有 {0} 个，请使用文件搜索': '{0} more; use file search', '外部依赖：{0}{1}': 'External dependencies: {0}{1}', '，另有 {0} 个': ', plus {0} more',
    '符号（{0}）': 'Symbols ({0})', '第 {0} 行': 'Line {0}', '匹配 {0} 个，先显示 300 个；继续输入可缩小范围。': '{0} matches; showing the first 300. Type more to narrow the results.',
    '第 {0}–{1} 行 / 共 {2} 行': 'Lines {0}–{1} of {2}', '正在读取该版本的源码…': 'Loading source at this version…',
    '源码版本与地图不一致，请重新打开': 'The source version does not match the map. Open the map again.', '当前页内容过长，显示已截取的部分。': 'This page is too large; only part of its content is shown.',
    '缺少仓库信息，请从仓库详情打开地图': 'Repository information is missing. Open the map from repository details.',
    '{0} @ {1} · 发布于 {2}': '{0} @ {1} · Published {2}', '{0} 个索引文件 · {1} 条文件依赖': 'Indexed files: {0} · File dependencies: {1}',
    '浏览器不允许复制，请选择源码手工复制。': 'Copying is unavailable. Select and copy the source manually.',
    '请求内容超过限制': 'The request exceeds the size limit', '请求必须为有效 JSON': 'The request must contain valid JSON', '分支名称格式错误': 'Invalid branch name',
    '拒绝跨站请求': 'Cross-site requests are not allowed', '请登录管理页面': 'Sign in to the admin console', '页面不存在': 'Page not found', '请使用 application/json': 'Use application/json',
    '登录尝试过多，请 5 分钟后重试': 'Too many sign-in attempts. Try again in 5 minutes.', '管理密码不正确': 'Incorrect admin password', '当前管理密码不正确': 'Incorrect current admin password',
    '代码源连接不存在': 'Source connection not found', '请选择代码源连接；存在多个连接时必须传入 connectionId': 'Select a source connection. connectionId is required when multiple connections exist.',
    '请使用多连接接口并指定连接 id': 'Use the multiple-connection API and specify a connection id', '最多配置 32 个代码源连接': 'At most 32 source connections are allowed',
    '请先移除该连接的仓库配置，再更换平台或地址；快照会保留': 'Remove the attached repository configurations before changing the platform or URL. Snapshots will remain.',
    '连接已被修改，请刷新后重试': 'The connection changed. Refresh and try again.', '该连接已有仓库，请刷新后重试': 'Repositories were attached to this connection. Refresh and try again.',
    '请先移除该连接的仓库配置；已有快照不会删除': 'Remove the attached repository configurations first. Existing snapshots will remain.',
    '无法识别默认分支，请填写同步分支': 'The default branch could not be identified. Enter a sync branch.', '仓库不存在': 'Repository not found',
    '同步间隔需为 1–1440 分钟': 'The sync interval must be 1–1440 minutes', '建图超时需为 5–360 分钟': 'The build timeout must be 5–360 minutes',
    '请选择 GitLab、GitHub 或通用 Git': 'Choose GitLab, GitHub or generic Git', '连接名称需为 1–80 个字符': 'The connection name must contain 1–80 characters', 'GitLab 连接需要访问令牌': 'GitLab connections require an access token',
    '更换平台或地址时请填写新凭据': 'Enter new credentials when changing the platform or URL', '请填写有效的密码 / Access Token，或选择无需认证': 'Enter a valid password / access token, or choose no authentication',
    'Git 用户名格式错误': 'Invalid Git username', 'CA 证书过长': 'The CA certificate is too long', '请填写 PEM 格式的 CA 证书': 'Enter a PEM-format CA certificate',
    '仓库必须属于所选连接': 'The repository must belong to the selected connection', '仓库路径格式错误': 'Invalid repository path', 'GitHub 响应超过限制': 'The GitHub response exceeds the size limit',
    'GitHub HTTP {0}：检查仓库地址、令牌权限、组织授权及 API 速率限制': 'GitHub HTTP {0}: check the repository URL, token permissions, organization authorization and API rate limits',
    'GitHub 未返回 JSON，请检查服务首页地址': 'GitHub did not return JSON. Check the service base URL.', 'GitHub 请求超时': 'The GitHub request timed out', 'GitHub 列表响应格式错误': 'Invalid GitHub list response',
    'GitHub 分页信息无效': 'Invalid GitHub pagination information', 'GitHub 列表超过查询上限，请缩小范围': 'The GitHub list exceeds the query limit. Narrow the search.', 'GitHub 仓库信息无效': 'Invalid GitHub repository information',
    'GitHub 返回的连接信息无效': 'GitHub returned invalid connection information', '通用 Git 会在添加仓库时通过实际 Git 握手验证地址和读取权限': 'The URL and read access are verified through a real Git handshake when adding a repository',
    'GitHub 仓库格式应为 owner/repository': 'Use owner/repository for a GitHub repository', '通用 Git 需要完整的 HTTP(S) 仓库地址': 'Generic Git requires a full HTTP(S) repository URL', '远端仓库暂无可同步的分支': 'The remote repository has no branches to sync',
    '请直接填写具体仓库地址': 'Enter a specific repository URL', '远端分支超过查询上限': 'The remote branch count exceeds the query limit', '同步任务超时或已停止': 'The sync task timed out or was stopped',
    '源码路径无效': 'Invalid source path', '源码页码无效': 'Invalid source pagination', '源码路径超出当前版本': 'The source path is outside this version', '源码链接指向当前版本以外': 'The source link points outside this version',
    '当前文件超过 5 MiB，无法在页面预览': 'This file exceeds 5 MiB and cannot be previewed', '源码文件在读取时发生变化，请重新打开地图': 'The source file changed while being read. Open the map again.', '当前文件为二进制，无法在页面预览': 'Binary files cannot be previewed',
    '仓库不存在或已暂停': 'The repository does not exist or is paused', '仓库尚未发布，请等待建图完成': 'The repository is not published yet. Wait for the map build to finish.',
    '仓库已有新发布版本，请从仓库详情重新打开地图': 'A newer repository version is published. Open the map again from repository details.',
    '正在为已有地图准备查看数据，请稍候': 'Preparing viewer data for the existing map. Please wait.', '查看地图数据与发布版本不一致，请重新同步': 'The viewer data does not match the published version. Sync the repository again.',
    '打开的地图过多，请稍后重试': 'Too many maps are open. Try again later.', '地图会话已过期，请重新打开地图': 'The map session expired. Open the map again.', '文件不在当前地图中': 'This file is not in the current map',
    '恢复已发布版本': 'Restoring the published version', '获取 {0} 最新代码': 'Fetching the latest code from {0}', '建立 {0} 的代码地图': 'Building the code map for {0}',
    '代码未变化': 'Code unchanged', '代码未变化，继续服务 {0}': 'Code unchanged; continuing to serve {0}',
    '配置已变化，等待重新同步': 'Configuration changed; waiting to sync again', '配置已变化，本轮结果不发布': 'Configuration changed; this result will not be published',
    '已发布 {0} @ {1}': 'Published {0} @ {1}', '{0}；已用 {1} 秒': '{0}; {1}s elapsed',
    '同步失败：{0}': 'Sync failed: {0}', 'git 退出码 {0}：{1}': 'git exited with code {0}: {1}',
    '建图超时：达到 {0} 分钟上限；已处理 {1}/{2} 个文件。可在管理设置调整建图超时后重试。': 'Map build timed out after {0} minutes; {1}/{2} files processed. Adjust the build timeout in Settings and try again.',
    '建图失败：{0}': 'Map build failed: {0}',
    '请传入仓库 repoId 查询分支': 'Pass a repository repoId to list branches', '每次填写 1–50 个仓库': 'Specify 1–50 repositories at a time', '连接已变化，请刷新后重试': 'The connection changed. Refresh and try again.',
    '仓库配置不存在': 'Repository configuration not found', '启用状态格式错误': 'Invalid enabled state', '接口不存在': 'API endpoint not found', '管理密码需为 12–256 个字符': 'The admin password must contain 12–256 characters',
    '服务地址需为 HTTP/HTTPS 服务地址，不包含凭据、查询参数或片段': 'Enter an HTTP(S) service URL without credentials, query parameters or fragments',
    '仓库地址必须属于所选代码源，且不包含凭据': 'The repository URL must belong to the selected source and contain no credentials',
    '更换 GitLab 地址时请填写新凭据': 'Enter new credentials when changing the GitLab URL', '请填写有效的 GitLab Access Token': 'Enter a valid GitLab access token', 'GitLab 组路径格式错误': 'Invalid GitLab group path',
    'GitLab 响应超过限制': 'The GitLab response exceeds the size limit',
    'GitLab HTTP {0}：检查 Token 是否有效': 'GitLab HTTP {0}: check that the token is valid',
    'GitLab HTTP {0}：检查 read_api 权限和项目访问权': 'GitLab HTTP {0}: check read_api permission and project access',
    'GitLab HTTP {0}：检查项目或组路径及访问权限': 'GitLab HTTP {0}: check the project or group path and access permissions',
    'GitLab HTTP {0}：检查 GitLab 服务状态': 'GitLab HTTP {0}: check the GitLab service status',
    'GitLab 未返回 JSON，请检查服务地址是否包含正确的子路径': 'GitLab did not return JSON. Check that the service URL includes the correct path prefix.', 'GitLab 请求超时': 'The GitLab request timed out',
    'GitLab 列表响应格式错误': 'Invalid GitLab list response', 'GitLab 分页信息无效': 'Invalid GitLab pagination information', '项目数量超过本次发现上限，请缩小 GitLab 组范围': 'The project count exceeds the discovery limit. Narrow the GitLab group scope.',
    'GitLab 项目信息无效': 'Invalid GitLab project information', 'SSH 仓库地址必须属于配置的 GitLab': 'The SSH repository address must belong to the configured GitLab service',
    '读取令牌不存在': 'Read token not found', '请在 AI 接入中创建读取令牌': 'Create a read token in AI access', '令牌名称需为 1–80 个字符': 'The token name must contain 1–80 characters',
    '请选择允许访问的仓库': 'Select the allowed repositories', '所选仓库不存在，请刷新后重试': 'A selected repository no longer exists. Refresh and try again.', '新令牌至少选择一个仓库': 'Select at least one repository for a new token',
    '令牌启用状态无效': 'Invalid token enabled state', '最多创建 64 个读取令牌': 'At most 64 read tokens are allowed', '读取权限已变更，请重新连接 MCP': 'Read permissions changed. Reconnect MCP.',
    '地图会话已过期，请重新打开': 'The map session expired. Open the map again.', '仓库已暂停或移除，地图访问已停止': 'The repository is paused or removed. Map access has stopped.',
  };
  const storageKey = 'repo-harbor.language';
  const normalize = value => typeof value === 'string' && /^zh(?:-|$)/i.test(value) ? 'zh-CN' : typeof value === 'string' && /^en(?:-|$)/i.test(value) ? 'en' : null;
  const browserLanguage = () => normalize(globalThis.navigator?.language) || 'en';
  let language;
  try { language = normalize(globalThis.localStorage?.getItem(storageKey)); } catch {}
  language ||= browserLanguage();
  for (const phase of ['启动解析器', '扫描文件', '文件索引', '符号关系', '生成查看地图', '地图就绪', '验证地图', '建图失败']) messages[`${phase}；已用 {0} 秒`] = `${messages[phase]}; {0}s elapsed`;
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).sort((a, b) => b[0].replace(/\{\d+\}/g, '').length - a[0].replace(/\{\d+\}/g, '').length).map(([key, value]) => {
    const indices = []; const parts = key.split(/(\{\d+\})/);
    const source = parts.map(part => /^\{\d+\}$/.test(part) ? (indices.push(Number(part.slice(1, -1))), '([\\s\\S]*?)') : escapePattern(part)).join('');
    return { regex: new RegExp(`^${source}$`), value, indices };
  });
  const format = (template, values) => template.replace(/\{(\d+)\}/g, (match, index) => values[index] === undefined ? match : String(values[index]));
  function t(key, values) {
    const raw = String(key ?? '');
    if (values) return format(language === 'en' ? messages[raw] ?? raw : raw, values);
    if (language !== 'en' || !raw) return raw;
    if (Object.hasOwn(messages, raw)) return messages[raw];
    for (const { regex, value, indices } of patterns) {
      const match = regex.exec(raw);
      if (match) { const args = []; indices.forEach((index, i) => args[index] = match[i + 1]); return format(value, args); }
    }
    return raw; // Keep unknown diagnostics verbatim, including messages from Git and parsers.
  }
  function tr(parts, ...values) { return t(parts.reduce((key, part, i) => key + (i ? `{${i - 1}}` : '') + part, ''), values); }
  const bindings = new WeakMap(), staticText = [], staticAttributes = [];
  function text(element, value) { bindings.set(element, value); element.setAttribute('data-i18n-dynamic', ''); element.textContent = t(typeof value === 'function' ? value() : value); }
  function clear(root) { for (const element of root.querySelectorAll('[data-i18n-dynamic]')) { bindings.delete(element); element.removeAttribute('data-i18n-dynamic'); } }
  function apply() {
    if (!globalThis.document) return;
    document.documentElement.lang = language;
    for (const { node, value } of staticText) if (node.isConnected) node.nodeValue = value.replace(value.trim(), t(value.trim()));
    for (const entry of staticAttributes) {
      if (entry.element.getAttribute(entry.name) !== entry.last) continue;
      entry.last = t(entry.value); entry.element.setAttribute(entry.name, entry.last);
    }
    for (const element of document.querySelectorAll('[data-i18n-dynamic]')) {
      const value = bindings.get(element);
      if (value === undefined) continue;
      element.textContent = t(typeof value === 'function' ? value() : value);
    }
    for (const select of document.querySelectorAll('[data-language]')) select.value = language;
  }
  function setLanguage(value, persist = true) {
    const next = normalize(value); if (!next) return false;
    language = next;
    if (persist) { try { globalThis.localStorage?.setItem(storageKey, next); } catch {} }
    apply(); globalThis.dispatchEvent?.(new CustomEvent('repo-harbor:language', { detail: { language } })); return true;
  }
  const date = value => value ? new Date(value).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { hour12: false }) : '—';
  const list = values => values.join(language === 'en' ? ', ' : '，');
  globalThis.RepoHarborI18n = { t, tr, text, clear, date, list, setLanguage, get language() { return language; }, messages };
  if (globalThis.document) {
    // Register only the initial, trusted HTML, before repositories or source code are rendered.
    const walker = document.createTreeWalker(document.documentElement, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement.closest('script, style, textarea, pre') && Object.hasOwn(messages, node.nodeValue.trim())) staticText.push({ node, value: node.nodeValue });
    }
    for (const element of document.querySelectorAll('[placeholder], [aria-label], [title]')) for (const name of ['placeholder', 'aria-label', 'title']) {
      const value = element.getAttribute(name);
      if (value && Object.hasOwn(messages, value)) staticAttributes.push({ element, name, value, last: value });
    }
    document.addEventListener('change', event => { if (event.target.matches('[data-language]')) setLanguage(event.target.value); });
    globalThis.addEventListener('storage', event => { if (event.key === storageKey) setLanguage(normalize(event.newValue) || browserLanguage(), false); });
    apply();
  }
})();
