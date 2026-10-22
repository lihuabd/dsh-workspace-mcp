import type { Config as McpClientPluginConfig, ReconnectConfig } from '@deepseek-ai/dsh-mcp-client';
import { type VariableSource } from './env.js';
/** stdio 传输的客户端配置（复用官方类型，避免结构漂移）。 */
export type StdioClientConfig = Extract<McpClientPluginConfig, {
    transport: 'stdio';
}>;
/** Streamable HTTP 传输的客户端配置（复用官方类型）。 */
export type HttpMcpClientConfig = Extract<McpClientPluginConfig, {
    transport: 'streamable-http';
}>;
/** 传给 `@deepseek-ai/dsh-mcp-client` 的单台服务器配置。 */
export type McpClientConfig = McpClientPluginConfig;
/** 项目文件里单台服务器的原始声明（未展开变量的形态）。 */
export interface McpServerDeclaration {
    /** `stdio` / `http` / `streamable-http`；缺省时按 command/url 推断。 */
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    /** stdio 服务器的工作目录，相对配置文件所在目录解析。 */
    cwd?: string;
    /** 为 true 时跳过该服务器。 */
    disabled?: boolean;
    /** 单台服务器覆盖全局工具调用超时。 */
    toolCallTimeoutMs?: number;
    /** 单台服务器覆盖服务器指令的最大字节数（mcp-client 默认 32768）。 */
    maxInstructionBytes?: number;
    /** 单台服务器覆盖断线重连策略。 */
    reconnect?: ReconnectConfig;
}
/** 单台服务器的解析问题；只影响该条目，不影响整份文件。 */
export interface ProjectFileIssue {
    /** 项目文件里的原始服务器名。 */
    server: string;
    /** 可读的失败原因。 */
    message: string;
}
/** 解析后的项目文件。 */
export interface ProjectFile {
    /** 绝对路径。 */
    file: string;
    /** 服务器名 → 声明。 */
    servers: Record<string, McpServerDeclaration>;
    /** 被跳过的服务器条目；其余条目仍然可用。 */
    issues: ProjectFileIssue[];
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
 * 与 ACP 的同名逻辑同源（两处都未导出公共实现），但这里刻意更宽松：先 `trim`，
 * 空名也会得到稳定的 `server_<hash>`，而不是让整条服务器因命名问题消失。
 *
 * @param name - 项目文件里的服务器名。
 * @returns 长度不超过 32 的合法 namespace。
 */
export declare function normalizeServerName(name: string): string;
/** 命中的项目文件及其所在目录（相对候选路径的解析基准）。 */
export interface ProjectFileLocation {
    /** 绝对路径。 */
    file: string;
    /** 执行查找的目录：会话工作目录或某个父目录。 */
    directory: string;
}
/**
 * 在会话工作目录（可选地向父目录）查找第一个存在的项目配置文件，并返回命中目录。
 *
 * @param cwd - 会话工作目录，绝对路径。
 * @param files - 候选相对路径，按优先级排列。
 * @param maxParentDepth - 向上查找的层数；0 表示只看当前目录。
 * @param exists - 文件存在性判断，默认 `node:fs` 的实现由调用方注入。
 * @returns 命中的绝对路径与所在目录，未命中返回 undefined。
 */
export declare function locateProjectFile(cwd: string, files: readonly string[], maxParentDepth: number, exists: (path: string) => boolean): ProjectFileLocation | undefined;
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
 * 文件级问题（不是合法 JSON、顶层结构不对）仍然抛出；单台服务器的字段问题
 * 只记录到 {@link ProjectFile.issues}，不牵连同文件里的其他服务器。
 *
 * @param rawText - 文件内容。
 * @param source - 文件绝对路径，用于错误信息。
 * @returns 服务器名 → 声明，以及被跳过的条目。
 * @throws {ProjectFileError} 内容不是合法 JSON 或文件级结构不符合约定。
 */
export declare function parseProjectFile(rawText: string, source: string): ProjectFile;
/**
 * 把一条声明翻译成 dsh-mcp-client 的配置。
 *
 * @param name - 原始服务器名。
 * @param declaration - 已归一化的声明。
 * @param projectRoot - 配置文件所在目录，用作 stdio 的默认 cwd 与相对路径基准。
 * @param options - 变量来源与默认值覆盖。
 * @returns 可直接传给 mcp-client 插件的配置对象。
 * @throws {ProjectFileError} 声明缺少必要字段或使用了不支持的传输。
 */
export declare function toClientConfig(name: string, declaration: McpServerDeclaration, projectRoot: string, options: {
    variables: VariableSource;
    failOnStartupError: boolean;
    toolCallTimeoutMs: number;
    /** 变量缺失回调：用于区分「不存在」与「存在但被环境放行策略拦下」。 */
    onMissingEnv?: (name: string) => void;
}): McpClientConfig;
