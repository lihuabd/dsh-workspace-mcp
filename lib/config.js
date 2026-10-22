/**
 * 项目级 MCP 配置的插件配置（Cordis `Config`）。
 *
 * @module dsh-workspace-mcp/config
 */
import Schema from '@deepseek-ai/schemastery';
/** 默认按优先级查找的项目配置文件（相对会话工作目录）：优先 DSH 原生文件，回退到 Claude Code 兼容文件。 */
export const DEFAULT_FILES = ['.dsh/mcp.json', '.mcp.json'];
/**
 * 插件配置 schema：由 Cordis 在激活插件行时校验并填充默认值。
 * 所有字段都有默认值，因此 bundle 的 patch 可以只写 `config: {}`。
 */
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).description('总开关；false 时不读取任何项目文件。'),
    files: Schema.array(String)
        .default([...DEFAULT_FILES])
        .description('按顺序在会话工作目录中查找的项目配置文件，取第一个存在的。'),
    searchParents: Schema.boolean()
        .default(false)
        .description('当前目录没有配置文件时，是否向父目录查找（层数由 maxParentDepth 控制）。'),
    maxParentDepth: Schema.natural().max(16).default(3).description('向父目录查找的最大层数。'),
    includeSubagents: Schema.boolean()
        .default(false)
        .description('是否也为子 agent（subagent）挂载；默认只在顶层会话挂载。子 agent 不会继承父 agent 作用域里的项目 MCP 工具。'),
    failOnStartupError: Schema.boolean()
        .default(false)
        .description('项目中的服务器连接失败时是否让会话创建失败；默认只记录告警并继续。true 会同时停止该服务器的自动重连。'),
    startupTimeoutMs: Schema.natural()
        .default(20_000)
        .description('单台服务器首次连接与工具同步的启动预算（毫秒）；超时只记录失败并在后台继续连接，不阻塞会话；0 表示不限制。'),
    toolCallTimeoutMs: Schema.natural()
        .min(1)
        .default(60_000)
        .description('单个 MCP 工具调用与资源请求的默认超时（毫秒）。'),
    env: Schema.dict(String)
        .default({})
        .description('展开 ${VAR} 时使用的额外变量；始终可见，优先级高于进程环境。'),
    envAllowlist: Schema.array(String)
        .default([])
        .description('允许从进程环境展开的变量名模式；空数组表示不继承任何进程变量。支持精确名、PREFIX_* 前缀与 *（放行全部）。'),
});
