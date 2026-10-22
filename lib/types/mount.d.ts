import type { WorkspaceMcpConfig } from './config.js';
import { type McpClientConfig } from './project-file.js';
/** 项目配置文件的大小上限：配置应当是几百字节的 JSON，而不是数据文件。 */
export declare const MAX_PROJECT_FILE_BYTES: number;
/** 挂载所需的最小会话信息（结构类型，避免与具体 Session 实现耦合）。 */
export interface ProjectSessionLike {
    header: {
        /** 会话创建时的绝对工作目录。 */
        cwd?: string;
        /** 会话的产品分类；`subagent` 表示这是子 agent 会话。 */
        origin?: 'subagent';
    };
}
/** 挂载流程依赖的宿主能力。 */
export interface MountHost {
    /** 把一台服务器挂到当前 agent 作用域，返回可等待的挂载结果。 */
    plugin(config: McpClientConfig): Promise<unknown>;
    /** 记录诊断信息。 */
    log(level: 'info' | 'warn', message: string): void;
}
/** 文件系统访问，便于在测试中替换。 */
export interface MountIo {
    exists(path: string): boolean;
    readFile(path: string): string;
}
/** 单台服务器的挂载失败记录。 */
export interface MountFailure {
    server: string;
    message: string;
}
/** 一次挂载的结果；失败被收集而不是抛出。 */
export interface MountResult {
    /** 命中的项目配置文件绝对路径。 */
    file?: string;
    /** 成功挂载的服务器名（项目文件里的原始名）。 */
    mounted: string[];
    /** 挂载失败的服务器。 */
    failed: MountFailure[];
}
/**
 * 单台服务器的启动预算耗尽；连接仍在后台继续，但本次不再阻塞会话创建。
 *
 * `server` 是项目文件里的原始服务器名，`timeoutMs` 是触发超时的预算（毫秒）。
 */
export declare class StartupTimeoutError extends Error {
    readonly server: string;
    readonly timeoutMs: number;
    constructor(server: string, timeoutMs: number);
}
/** 生产环境使用的文件系统实现。 */
export declare const nodeMountIo: MountIo;
/**
 * 为一次 agent 创建挂载项目级 MCP 服务器。
 *
 * 所有服务器并发启动；`config.startupTimeoutMs` 是每台服务器首次连接与工具
 * 同步的预算，超时只记录失败，不阻塞会话。只有显式打开
 * `config.failOnStartupError` 时，连接/启动失败才会让本函数抛出。
 *
 * @param session - 该 agent 的会话（读取 `header.cwd` 与 `header.origin`）。
 * @param config - 插件配置。
 * @param host - 插件挂载与日志能力。
 * @param io - 文件系统访问实现，默认使用 `node:fs`。
 * @returns 命中的文件、成功的服务器与失败清单。
 * @throws 仅在 `config.failOnStartupError` 为 true 且存在启动失败时抛出。
 */
export declare function mountProjectServers(session: ProjectSessionLike, config: WorkspaceMcpConfig, host: MountHost, io?: MountIo): Promise<MountResult>;
