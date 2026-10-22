/**
 * 项目级 MCP 配置的插件配置（Cordis `Config`）。
 *
 * @module dsh-workspace-mcp/config
 */
import Schema from '@deepseek-ai/schemastery';
/** 默认按顺序查找的项目配置文件（相对会话工作目录）。 */
export declare const DEFAULT_FILES: string[];
/** 插件行 `config` 解析后的有效配置。 */
export interface WorkspaceMcpConfig {
    /** 总开关；false 时不读取任何项目文件，也不挂载任何服务器。 */
    enabled: boolean;
    /** 按顺序查找的第一个存在的项目配置文件。 */
    files: string[];
    /** 当前目录没有配置文件时，是否继续向父目录查找。 */
    searchParents: boolean;
    /** 向父目录查找的最大层数（`searchParents` 为 true 时生效）。 */
    maxParentDepth: number;
    /** 是否也为子 agent（subagent）挂载项目 MCP 服务器。 */
    includeSubagents: boolean;
    /** 项目中的服务器连接失败时，是否让会话创建失败；默认只记录告警。 */
    failOnStartupError: boolean;
    /** 单个 MCP 工具调用与资源请求的默认超时（毫秒）。 */
    toolCallTimeoutMs: number;
    /** 展开 `${VAR}` 时使用的额外变量，优先级高于进程环境。 */
    env: Record<string, string>;
}
/**
 * 插件配置 schema：由 Cordis 在激活插件行时校验并填充默认值。
 * 所有字段都有默认值，因此 bundle 的 patch 可以只写 `config: {}`。
 */
export declare const Config: Schema<WorkspaceMcpConfig>;
