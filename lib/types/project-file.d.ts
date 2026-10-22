import { type VariableSource } from './env.js';
/** stdio 传输的客户端配置。 */
export interface StdioClientConfig {
    transport: 'stdio';
    serverName: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
    toolCallTimeoutMs: number;
    failOnStartupError: boolean;
}
/** Streamable HTTP 传输的客户端配置。 */
export interface HttpMcpClientConfig {
    transport: 'streamable-http';
    serverName: string;
    url: string;
    headers: Record<string, string>;
    toolCallTimeoutMs: number;
    failOnStartupError: boolean;
}
/** 传给 `@deepseek-ai/dsh-mcp-client` 的单台服务器配置。 */
export type McpClientConfig = StdioClientConfig | HttpMcpClientConfig;
/** 项目文件里单台服务器的原始声明（未展开变量的形态）。 */
export interface McpServerDeclaration {
    /** `stdio` / `http` / `streamable-http`；缺省时按 command/url 推断。 */
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    /** stdio 服务器的工作目录，相对项目根目录解析。 */
    cwd?: string;
    /** 为 true 时跳过该服务器。 */
    disabled?: boolean;
    /** 单台服务器覆盖全局工具调用超时。 */
    toolCallTimeoutMs?: number;
}
/** 解析后的项目文件。 */
export interface ProjectFile {
    /** 绝对路径。 */
    file: string;
    /** 服务器名 → 声明。 */
    servers: Record<string, McpServerDeclaration>;
}
/** 项目文件内容不合法时抛出的可诊断错误。 */
export declare class ProjectFileError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
/**
 * 把原始服务器名规范成 dsh-mcp-client 接受、且可安全用作工具名段的 namespace。
 *
 * 合法名原样返回；不合法时做有损规范化并追加 8 位哈希后缀，避免不同名字折叠成同一个。
 *
 * @param name - 项目文件里的服务器名。
 * @returns 长度不超过 32 的合法 namespace。
 */
export declare function normalizeServerName(name: string): string;
/**
 * 在会话工作目录（可选地向父目录）查找第一个存在的项目配置文件。
 *
 * @param cwd - 会话工作目录，绝对路径。
 * @param files - 候选相对路径，按优先级排列。
 * @param maxParentDepth - 向上查找的层数；0 表示只看当前目录。
 * @param exists - 文件存在性判断，默认 `node:fs` 的实现由调用方注入。
 * @returns 命中的绝对路径，未命中返回 undefined。
 */
export declare function findProjectFile(cwd: string, files: readonly string[], maxParentDepth: number, exists: (path: string) => boolean): string | undefined;
/**
 * 解析项目文件文本，校验 `mcpServers` 的结构并归一化字段。
 *
 * @param text - 文件内容。
 * @param source - 文件绝对路径，用于错误信息。
 * @returns 服务器名 → 声明。
 * @throws {ProjectFileError} 内容不是合法 JSON 或结构不符合约定。
 */
export declare function parseProjectFile(text: string, source: string): ProjectFile;
/**
 * 把一条声明翻译成 dsh-mcp-client 的配置。
 *
 * @param name - 原始服务器名。
 * @param declaration - 已归一化的声明。
 * @param projectRoot - 项目根目录（会话工作目录），用作 stdio 的默认 cwd。
 * @param options - 变量来源与默认值覆盖。
 * @returns 可直接传给 mcp-client 插件的配置对象。
 * @throws {ProjectFileError} 声明缺少必要字段或使用了不支持的传输。
 */
export declare function toClientConfig(name: string, declaration: McpServerDeclaration, projectRoot: string, options: {
    variables: VariableSource;
    failOnStartupError: boolean;
    toolCallTimeoutMs: number;
}): McpClientConfig;
