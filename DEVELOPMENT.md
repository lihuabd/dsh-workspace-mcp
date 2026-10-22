# dsh-workspace-mcp 开发文档

面向维护者与贡献者。安装与使用说明见 [README.md](README.md)。

## 项目结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | Cordis 插件入口：监听 `agent/created`/`agent/disposed`，挂载与释放 agent 作用域里的 MCP 实例 |
| `src/mount.ts` | 单次 agent 创建的挂载编排：发现文件、并发启动、启动预算、失败汇总与审计日志 |
| `src/project-file.ts` | 项目文件查找、解析、字段归一化，以及转换成 `dsh-mcp-client` 配置 |
| `src/env.ts` | `${VAR}` / `${VAR:-默认值}` 展开与 `envAllowlist` 模式匹配 |
| `src/config.ts` | Cordis `Config` schema 与默认值 |
| `lib/` | 提交进仓库的构建产物；`lib/types/` 是类型声明 |
| `test/` | `node:test` 测试；`manifest.test.mjs` 锁 package 契约，`market-index.test.mjs` 校验市场索引 |
| `scripts/verify-pack.mjs` | 校验 `npm pack` 实际清单包含 patch、locale、icon 与全部运行时文件 |
| `cordis.patch.yml` | bundle 层插入的插件行 |
| `locale/`、`icon.svg` | 插件页显示元数据与图标 |
| `examples/mcp.json` | 项目文件示例 |

## 工作原理

1. 插件在根作用域监听 `agent/created`。Harness 会等待该事件的串行监听器结算后，才释放排队中的首轮工作，因此 **第一次模型请求就能看到 MCP 工具**。
2. 读取 `agent.session.header.cwd` 下的项目文件：优先 `.dsh/mcp.json`，没有时回退 `.mcp.json`；同一目录两者都存在时优先前者并告警。
3. 把每台服务器作为独立的 `@deepseek-ai/dsh-mcp-client` 实例挂到 `agent.ctx`（agent 作用域）。
4. 所有服务器**并发启动**，并各自受 `startupTimeoutMs` 约束：最坏等待是一个预算，而不是所有服务器超时之和。
5. 工具、资源与系统提示词片段都注册在该 agent 作用域：会话销毁时自动断开连接、移除工具；插件被卸载（含 HMR）时也会主动释放。
6. 单台服务器失败只影响它自己；会话创建默认永远不会因为项目 MCP 而失败（除非显式打开 `failOnStartupError`）。
7. 配置文件的父目录命中时（`searchParents`），`cwd` 与相对路径以**配置文件所在目录**为基准，而不是当前会话子目录。

## 开发

```sh
pnpm install
pnpm build          # 产出 lib/（仓库里提交，便于从 git 直接安装）
pnpm typecheck
pnpm test           # node:test，覆盖解析、规范化与 Cordis 事件挂载链路
pnpm verify:pack    # 校验 npm 打包清单包含 patch/locale/icon/运行时
```

`lib/` 是提交进仓库的构建产物，CI 会校验它与 `src/` 同步，并用 `pnpm verify:pack` 检查实际打包清单。修改源码后请重新 `pnpm build` 再提交。

`prepublishOnly` 会先构建再运行打包校验，因此 `npm publish` 前不需要额外手动检查。`test/manifest.test.mjs` 会锁住 `dsh.bundle.patch`、`engines.dsh`、`./icon` 导出、`files` 清单和 locale 元数据。

## 本地验收

```sh
export DSH_HOME="$PWD/.verify/dsh-home"
dsh plugin --profile verify add "$PWD"
dsh --profile verify --dump-config
dsh --profile verify --dump-config-schema   # 会真正 import 本包与 schemastery
```

真实挂载验收（不需要模型调用）：在临时目录放一个最小的 stdio MCP 服务器（启动时写标记文件）和一个 `.dsh/mcp.json`，用 `dsh --profile acp` 走完 `initialize` + `session/new`，标记文件出现即说明插件在 agent 创建时真的拉起了服务器进程。

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
3. `git tag v0.2.1 && git push origin v0.2.1`。

> `npm publish --provenance` 要求 `package.json` 的 `repository` 指向当前公开仓库；没填就先把工作流里的 `--provenance` 去掉，或补上仓库地址后再发。

用户侧如何添加索引，见 [README 的「插件市场」](README.md#插件市场)。

## 兼容性

运行时兼容范围、Node 版本与 peer 依赖说明见 [README 的「兼容性」](README.md#兼容性)。

## License

[MIT](LICENSE)
