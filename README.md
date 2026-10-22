# dsh-workspace-mcp

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的项目级 MCP 插件：**仓库里放一个 `.mcp.json`，在哪个项目目录开会话，就自动挂载哪个项目的 MCP 服务器**。

Harness 内置的 MCP 配置是 profile 级的（整个 profile 共享）。本插件把 MCP 配置下沉到项目：每个会话创建时读取自己的会话工作目录，把项目声明的服务器挂到该 agent 的作用域上，随会话销毁自动断开。桌面 GUI、`dsh web`、`dsh headless` 都生效。

## 安装

本包同时是一个 DSH bundle，安装后自动插入插件行：

```sh
# 从 npm（发布后）
dsh plugin --profile <profile> add dsh-workspace-mcp

# 直接从 GitHub
dsh plugin --profile <profile> add github:lihuabd/dsh-workspace-mcp
```

也可以使用桌面 GUI 的插件页或 Creator 模式里的 `plugin_manager`（`action: install_bundle`，`target` 指向包目录 / 包名）。

插件市场索引（在 DSH 插件页「发现」里添加为索引源）：<https://lihuabd.github.io/dsh-workspace-mcp/index.json>

安装后确认条目已进入配置树：

```sh
dsh --profile <profile> --dump-config | grep -A 4 workspace-mcp
```

## 项目文件

默认按顺序查找 `.mcp.json`、`.dsh/mcp.json`，格式与 Claude Code 兼容：

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
| `command` / `args` / `env` / `cwd` | stdio | 可执行文件、参数、额外环境变量、工作目录（相对项目根） |
| `url` / `headers` | http | Streamable HTTP 端点与请求头 |
| `disabled` | 全部 | `true` 时跳过该服务器 |
| `toolCallTimeoutMs` | 全部 | 覆盖该服务器的工具调用超时 |

- `${VAR}` 与 `${VAR:-默认值}` 会在 `command`、`args`、`env`、`url`、`headers`、`cwd` 中展开；变量来源是进程环境 + 插件配置的 `env`。
- 不支持 SSE 传输（`type: "sse"`），会给出明确报错并跳过该服务器。
- 服务器名会规范成 `[A-Za-z0-9_-]{1,32}`；有损规范化会追加 8 位哈希，避免重名折叠。工具名形如 `mcp__<serverName>__<tool>`。

## 插件配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（patch 会整段替换 `config`，未写的字段回到 schema 默认值）：

```yaml
- id: workspace-mcp
  name: dsh-workspace-mcp
  config:
    enabled: true
    files: ['.mcp.json', '.dsh/mcp.json']
    searchParents: false
    maxParentDepth: 3
    includeSubagents: false
    failOnStartupError: false
    toolCallTimeoutMs: 60000
    env: {}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `files` | `['.mcp.json', '.dsh/mcp.json']` | 按顺序查找的第一个存在的文件 |
| `searchParents` | `false` | 当前目录没有时向父目录查找 |
| `maxParentDepth` | `3` | 向上查找的最大层数 |
| `includeSubagents` | `false` | 是否也为子 agent 挂载（默认只在顶层会话挂载，避免重复拉起进程） |
| `failOnStartupError` | `false` | 服务器连接失败是否让会话创建失败；默认只记录告警并跳过 |
| `toolCallTimeoutMs` | `60000` | 单个 MCP 工具调用/资源请求超时 |
| `env` | `{}` | 展开 `${VAR}` 的额外变量，优先于进程环境 |

## 工作原理

1. 插件在根作用域监听 `agent/created`。Harness 会等待该事件的串行监听器结算后，才释放排队中的首轮工作，因此 **第一次模型请求就能看到 MCP 工具**。
2. 读取 `agent.session.header.cwd` 下的项目文件，把每个服务器作为独立的 `@deepseek-ai/dsh-mcp-client` 实例挂到 `agent.ctx`（agent 作用域）。
3. 工具、资源与系统提示词片段都注册在该 agent 作用域：会话销毁时自动断开连接、移除工具；插件被卸载（含 HMR）时也会主动释放。
4. 单台服务器失败只影响它自己；会话创建永远不会因为项目 MCP 而失败（除非显式打开 `failOnStartupError`）。

### 与全局 MCP 的关系

- 项目级 server 与 profile/`$DSH_HOME` 里配置的同名 server 可以共存：agent 作用域注册优先，会话内看到的是项目那份。
- 同一个作用域内重名会报错（与 `dsh-mcp-client` 的约定一致）。
- 每个会话各自持有连接：stdio 服务器会按会话启动进程。重服务器建议用 HTTP 传输或谨慎开启 `includeSubagents`。

### 已知限制

- 修改插件配置行（`cordis.patch.yml`）后，已存在的会话不会自动重新挂载，需要新开会话。
- 项目文件在会话创建时读取一次，运行中修改文件不会热更新。
- 会话没有 `header.cwd` 时（极少数无工作目录的会话）不挂载。

## 安全

项目文件可以拉起任意 stdio 进程，等同于把代码执行权交给仓库作者。请只在自己信任的仓库里使用，并：

- 凭据一律用 `${VAR}` 引用，不要把明文密钥提交到仓库；
- 用 `searchParents` 时注意上层目录可能属于其他项目；
- 默认只在顶层会话挂载，减少服务器进程数量。

## 开发

```sh
pnpm install
pnpm build          # 产出 lib/（仓库里提交，便于从 git 直接安装）
pnpm typecheck
pnpm test           # node:test，覆盖解析、规范化与 Cordis 事件挂载链路
```

`lib/` 是提交进仓库的构建产物，CI 会校验它与 `src/` 同步。修改源码后请重新 `pnpm build` 再提交。

本地验收：

```sh
export DSH_HOME="$PWD/.verify/dsh-home"
dsh plugin --profile verify add "$PWD"
dsh --profile verify --dump-config
dsh --profile verify --dump-config-schema   # 会真正 import 本包与 schemastery
```

真实挂载验收（不需要模型调用）：在临时目录放一个最小的 stdio MCP 服务器（启动时写标记文件）和一个 `.mcp.json`，用 `dsh --profile acp` 走完 `initialize` + `session/new`，标记文件出现即说明插件在 agent 创建时真的拉起了服务器进程。

## 发布到插件市场

### 现状：DSH 没有“官方市场”

截至 DSH 0.2.1-rc.2，官方**不内置任何索引源**（见 [`docs/user/guide/plugin-market`](https://deepseek-harness.github.io/deepseek-harness/)）。所谓“插件市场”是一个 `format: 1` 的 JSON 索引文件，放在任意静态主机上；用户开启实验性的**自定义插件市场** 组合包后，在插件页的**发现**标签页里添加索引 URL 即可浏览和安装。

因此“发布到市场”= 做两件事：

1. 把包装到 npm（或打 Git tag），这是真正的安装来源；
2. 生成并托管一份索引 JSON，指向该来源。

官方推荐的社区发现渠道是给仓库加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题（见 DSH README 的「社区与支持」）。如果之后官方开放了索引源，通常只需把本包加进它的索引。

### 前置条件

- `package.json` 必须声明 `dsh.bundle`（本包已有 `cordis.patch.yml`）；
- 每个上市版本必须在 `engines.dsh` 里声明 DSH 兼容范围（本包为 `>=0.1.7-0 <0.3.0`）；
- 建议补齐 `author`、`homepage`、`repository`，它们会出现在市场卡片和插件页。

### 步骤

```sh
# 1. 发布 npm 包（首次需要 npm 登录；--provenance 需公开仓库与 OIDC）
npm publish --access public

# 2. 从 registry 生成索引（自动复制 icon.svg 并用官方校验器校验）
pnpm market:index --url https://lihuabd.github.io/dsh-workspace-mcp/index.json

# 未发布时可以先本地演练
pnpm market:index:local
```

把 `site/` 目录发布到任意静态主机，例如 GitHub Pages（`site/index.json` + `site/icon.svg`）。索引里的相对图标会相对索引 URL 解析，因此两者必须放在同一目录。

本仓库的 [`.github/workflows/release.yml`](./.github/workflows/release.yml) 已经串好整条链路：推送 `v*` tag 后校验 tag 与版本一致 → 跑测试 → `npm publish --provenance` → 生成索引 → 部署 GitHub Pages。启用方式：

1. 仓库 Secrets 添加 `NPM_TOKEN`（npm Automation token）；
2. Settings → Pages → Source 选 **GitHub Actions**；
3. `git tag v0.1.0 && git push origin v0.1.0`。

> `npm publish --provenance` 要求 `package.json` 的 `repository` 指向当前公开仓库；没填就先把工作流里的 `--provenance` 去掉，或补上仓库地址后再发。

### 用户在 DSH 里添加索引

1. 插件页 → **实验性插件** → 更多 → 打开**自定义插件市场**；
2. **发现** → **添加索引源** → 填 `https://lihuabd.github.io/dsh-workspace-mcp/index.json`；
3. 搜索 `dsh-workspace-mcp`，确认来源后安装。

> 索引没有签名，市场里的标题、作者、来源都是发布方的声明。用户应只添加信任的索引源，并在安装确认框里核对来源。

## 兼容性


- DSH `>=0.1.7-0 <0.3.0`（peer 范围，安装时按运行时版本校验）。
- Node.js `>=22`。
- 依赖的 `@deepseek-ai/dsh-*` 均为可选 peer，由 Harness 安装目录提供，不重复安装。

## License

[MIT](./LICENSE)
