import type { WorkspaceMcpConfig } from './config.js';
import { type McpClientConfig } from './project-file.js';
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
/** 生产环境使用的文件系统实现。 */
export declare const nodeMountIo: MountIo;
/**
 * 为一次 agent 创建挂载项目级 MCP 服务器。
 *
 * @param session - 该 agent 的会话（读取 `header.cwd` 与 `header.origin`）。
 * @param config - 插件配置。
 * @param host - 插件挂载与日志能力。
 * @param io - 文件系统访问实现，默认使用 `node:fs`。
 * @returns 命中的文件、成功的服务器与失败清单；本函数不会抛错。
 */
export declare function mountProjectServers(session: ProjectSessionLike, config: WorkspaceMcpConfig, host: MountHost, io?: MountIo): Promise<MountResult>;
