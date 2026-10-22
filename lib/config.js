/**
 * 项目级 MCP 配置的插件配置（Cordis `Config`）。
 *
 * @module dsh-workspace-mcp/config
 */
import Schema from '@deepseek-ai/schemastery';
/** 默认按顺序查找的项目配置文件（相对会话工作目录）。 */
export const DEFAULT_FILES = ['.mcp.json', '.dsh/mcp.json'];
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
        .description('是否也为子 agent（subagent）挂载项目 MCP；默认只在顶层会话挂载。'),
    failOnStartupError: Schema.boolean()
        .default(false)
        .description('项目中的服务器连接失败时是否让会话创建失败；默认只记录告警并跳过该服务器。'),
    toolCallTimeoutMs: Schema.natural()
        .default(60_000)
        .description('单个 MCP 工具调用与资源请求的默认超时（毫秒）。'),
    env: Schema.dict(String)
        .default({})
        .description('展开 ${VAR} 时使用的额外变量，优先级高于进程环境。'),
});
