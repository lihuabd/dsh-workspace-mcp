# dsh-workspace-mcp

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的项目级 MCP 插件：**仓库里放一个 `.dsh/mcp.json`（兼容 `.mcp.json`），在哪个项目目录开会话，就自动挂载哪个项目的 MCP 服务器**。

Harness 内置的 MCP 配置是 profile 级的（整个 profile 共享）。本插件把 MCP 配置下沉到项目：每个会话创建时读取自己的会话工作目录，把项目声明的服务器挂到该会话，随会话销毁自动断开。桌面 GUI、`dsh web`、`dsh headless` 都生效。

npm 包：<https://www.npmjs.com/package/dsh-workspace-mcp>

## 安装

本包同时是一个 DSH bundle，安装后自动插入插件行（npm：<https://www.npmjs.com/package/dsh-workspace-mcp>）：

```sh
# 从 npm
dsh plugin --profile <profile> add dsh-workspace-mcp

# 直接从 GitHub
dsh plugin --profile <profile> add github:lihuabd/dsh-workspace-mcp
```

也可以使用桌面 GUI 的插件页或 Creator 模式里的 `plugin_manager`（`action: install_bundle`，`target` 指向包目录 / 包名）。

GUI 安装（插件页 → 添加插件 → 输入 `dsh-workspace-mcp` → 选择安装源 → 安装）：

![在 DSH 插件页安装 dsh-workspace-mcp](https://raw.githubusercontent.com/lihuabd/dsh-workspace-mcp/main/docs/images/install-gui.jpg)

> 截图中的安装源已做打码处理，请按你的网络环境选择 npm 官方源或镜像。

安装后确认条目已进入配置树：

```sh
dsh --profile <profile> --dump-config | grep -A 4 workspace-mcp
```

也可以从插件市场里安装，见下节。

## 插件市场

1. 插件页 → **实验性插件** → 更多 → 打开**自定义插件市场**；
2. **发现** → **添加索引源**，填入 <https://lihuabd.github.io/dsh-workspace-mcp/index.json>；
3. 搜索 `dsh-workspace-mcp`，确认来源后安装。

> 索引没有签名，市场里的标题、作者、来源都是发布方的声明。只添加信任的索引源，并在安装确认框里核对来源。

## 项目文件

默认优先查找 `.dsh/mcp.json`，不存在时回退到 `.mcp.json`（格式与 Claude Code 兼容）：

```json
{
  "mcpServers": {
    "cc-tools": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    },
    "local": {
      "command": "node",
      "args": ["./tools/mcp-server.js"],
      "env": { "TOKEN": "${LOCAL_TOKEN}" }
    }
  }
}
```

| 字段 | 适用传输 | 含义 |
|---|---|---|
| `type` | 可选 | `stdio` / `http` / `streamable-http`；缺省时按 `command`/`url` 推断 |
| `command` / `args` / `env` / `cwd` | stdio | 可执行文件、参数、额外环境变量、工作目录（相对**配置文件所在目录**） |
| `url` / `headers` | http | Streamable HTTP 端点与请求头 |
| `disabled` | 全部 | `true` 时跳过该服务器 |
| `toolCallTimeoutMs` | 全部 | 覆盖该服务器的工具调用超时 |
| `maxInstructionBytes` | 全部 | 覆盖服务器指令的最大字节数（mcp-client 默认 32768） |
| `reconnect` | 全部 | 覆盖断线重连策略（`enabled` / `initialDelayMs` / `maxDelayMs` / `maxAttempts`） |

> 示例里的 `${MCP_TOKEN}`、`${LOCAL_TOKEN}` 默认不会从进程环境展开；需要在插件配置里用 `envAllowlist` 放行，或用 `env` 显式提供（见下节）。`examples/mcp.json` 使用 `MCP_` 前缀，复制为 `.dsh/mcp.json`（或 `.mcp.json`）后配置 `envAllowlist: ['MCP_*']` 即可直接工作。

- `${VAR}` 与 `${VAR:-默认值}` 会在 `command`、`args`、`env`、`url`、`headers`、`cwd` 中展开。变量来源是插件配置的 `env`，加上 `envAllowlist` 放行的进程环境；**默认不继承任何进程环境变量**。
- 不支持 SSE 传输（`type: "sse"`），会给出明确报错并跳过该服务器。
- 服务器名会规范成 `[A-Za-z0-9_-]{1,32}`；有损规范化会追加 8 位哈希，避免重名折叠。工具名形如 `mcp__<serverName>__<tool>`。
- 文件允许带 UTF-8 BOM；单个服务器的字段写错只会跳过该服务器，不影响同一文件里的其他条目。
- 文件必须是常规文件且不超过 1 MB（拒绝 FIFO/设备/目录），避免同步读阻塞宿主事件循环。
- 同一目录内优先 `.dsh/mcp.json`；两者都存在时 `.mcp.json` 会被忽略并告警。开启 `searchParents` 时仍按目录由近到远查找，因此当前目录的 `.mcp.json` 会先于父目录的 `.dsh/mcp.json` 命中。
- 启动时会记录一条审计日志：服务器名 + 展开前的 `command`/`args`（或 `url`）；`env`/`headers` 的值不记录。

## 插件配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（patch 会整段替换 `config`，未写的字段回到 schema 默认值）：

```yaml
- id: workspace-mcp
  name: dsh-workspace-mcp
  config:
    enabled: true
    files: ['.dsh/mcp.json', '.mcp.json']
    searchParents: false
    maxParentDepth: 3
    includeSubagents: false
    failOnStartupError: false
    startupTimeoutMs: 20000
    toolCallTimeoutMs: 60000
    env: {}
    envAllowlist: []
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `files` | `['.dsh/mcp.json', '.mcp.json']` | 按顺序查找的第一个存在的文件；同一目录两者都存在时优先 `.dsh/mcp.json`，并告警被忽略的 `.mcp.json` |
| `searchParents` | `false` | 当前目录没有时向父目录查找 |
| `maxParentDepth` | `3` | 向上查找的最大层数 |
| `includeSubagents` | `false` | 是否也为子 agent 挂载。默认为 `false`：子 agent 不会自动获得父会话的项目 MCP 工具，需要时显式打开（每台服务器会各自拉起进程） |
| `failOnStartupError` | `false` | 首次连接失败是否让会话创建失败；默认只记录告警并继续（服务器会在后台重连）。`true` 时会话创建失败，且该服务器不再重连 |
| `startupTimeoutMs` | `20000` | 每台服务器首次连接 + 工具同步的启动预算；超时只记录失败、连接在后台继续，不阻塞会话（`failOnStartupError: true` 时超时也算启动失败）；`0` 表示不限制 |
| `toolCallTimeoutMs` | `60000` | 单个 MCP 工具调用/资源请求超时 |
| `env` | `{}` | 展开 `${VAR}` 的额外变量；始终可见，优先级最高 |
| `envAllowlist` | `[]` | 允许从进程环境展开的变量名模式；空数组表示不继承。支持精确名、`PREFIX_*` 与 `*` |

## 工作方式

- 会话创建时读取会话工作目录下的项目文件：优先 `.dsh/mcp.json`，没有时回退 `.mcp.json`。
- 每台服务器作为独立的 `dsh-mcp-client` 实例挂到该会话，工具随会话销毁自动移除。
- 挂载在首轮工作释放前完成（受 `startupTimeoutMs` 约束），所以第一次模型请求通常已经能看到工具。
- 同一会话的服务器并发启动，各自受 `startupTimeoutMs` 约束；单台失败不影响其他服务器。
- 默认只在顶层会话挂载；子 agent 不继承父会话的项目 MCP 工具，需要时打开 `includeSubagents`。

### 与全局 MCP 的关系

- 项目级 server 与 profile/`$DSH_HOME` 里配置的同名 server 可以共存：会话内看到的是项目那份。
- 同一个会话内重名会报错（与 `dsh-mcp-client` 的约定一致）。
- 每个会话各自持有连接：stdio 服务器会按会话启动进程。重服务器建议用 HTTP 传输或谨慎开启 `includeSubagents`。

### 已知限制

- 修改插件配置行（`cordis.patch.yml`）后，已存在的会话不会自动重新挂载，需要新开会话。
- 项目文件在会话创建时读取一次，运行中修改文件不会热更新。
- 会话没有 `header.cwd` 时（极少数无工作目录的会话）不挂载。
- 默认 `failOnStartupError: false` 时，「已挂载」只表示客户端实例已激活；首次连接失败会在后台重连，工具可能稍后才出现。打开 `failOnStartupError` 后，首次连接失败会让会话创建失败，且该服务器不再重连。
- `startupTimeoutMs` 超时只结束等待，服务器进程仍在后台尝试连接；它之后成功时工具会正常出现（`failOnStartupError: true` 时会话创建会失败）。
- 子 agent 不会自动获得父会话的项目 MCP 工具；`includeSubagents: false`（默认）意味着子 agent **没有**这些工具，而不是复用父会话的。

## 安全

- 项目文件可以拉起任意 stdio 进程，等同于把代码执行权交给仓库作者。**只在自己信任的仓库里使用**；下面的环境变量策略是纵深防御，不能替代这一前提。
- 默认不从进程环境展开变量：`${VAR}` 只解析插件配置的 `env` 与 `envAllowlist` 命中的名字。需要 `${GITHUB_TOKEN}` 这类写法时，显式配置 `envAllowlist: ['GITHUB_TOKEN']`（或 `['MCP_*']`）；被拦下的变量会告警并提示用 `env` / `envAllowlist` 显式提供。
- 凭据一律用 `${VAR}` 引用，不要把明文提交到仓库；审计日志记录的是**展开前**的 `command`/`args`（或 `url`），因此变量值不会进日志——但直接写在 `args` 里的明文仍会被记录。
- 每次启动会记录服务器名与启动方式，便于事后回答「这个仓库跑了什么」；`env`/`headers` 的值不记录。
- 用 `searchParents` 时注意上层目录可能属于其他项目；默认只在顶层会话挂载，减少服务器进程数量。
- 项目文件读取限制为常规文件且不超过 1 MB，避免 FIFO 或超大文件阻塞宿主。

## 兼容性

- DSH `>=0.1.7-0 <0.3.0`（peer 范围，安装时按运行时版本校验）。
- Node.js `>=22`。
- 依赖的 `@deepseek-ai/dsh-*` 均为可选 peer，由 Harness 安装目录提供，不重复安装。

## 开发

开发环境、测试、本地验收与发布流程见 [DEVELOPMENT.md](https://github.com/lihuabd/dsh-workspace-mcp/blob/main/DEVELOPMENT.md)。

## License

[MIT](./LICENSE)
