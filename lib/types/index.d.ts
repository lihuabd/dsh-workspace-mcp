/**
 * `dsh-workspace-mcp` 插件入口。
 *
 * 监听 `agent/created`，在 agent 发布后、首轮工作开始前，把会话工作目录下的
 * 项目级 MCP 配置挂载到该 agent 的作用域。挂载是 agent 作用域的副作用：
 * agent 销毁时自动断开连接并移除工具，插件卸载时也会主动释放。
 *
 * @module dsh-workspace-mcp
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type WorkspaceMcpConfig } from './config.js';
export { Config };
export type { WorkspaceMcpConfig };
export { DEFAULT_FILES } from './config.js';
export { matchesEnvPattern } from './env.js';
export type { VariableSource } from './env.js';
export { normalizeServerName, parseProjectFile, ProjectFileError } from './project-file.js';
export type { McpClientConfig, McpServerDeclaration, ProjectFileIssue } from './project-file.js';
export { MAX_PROJECT_FILE_BYTES, mountProjectServers, StartupTimeoutError } from './mount.js';
export type { MountFailure, MountHost, MountIo, MountResult } from './mount.js';
/** Cordis 插件名，用于 Loader 诊断。 */
export declare const name = "workspace-mcp";
/**
 * 插件激活入口：注册 agent 创建时的项目级 MCP 挂载。
 *
 * @param ctx - 插件上下文；其 fiber 拥有本插件注册的所有资源。
 * @param config - 已由 {@link Config} 校验并填充默认值的配置。
 */
export declare function apply(ctx: Context, config: WorkspaceMcpConfig): void;
