import * as McpClient from '@deepseek-ai/dsh-mcp-client';
import { Config } from './config.js';
import { mountProjectServers } from './mount.js';
export { Config };
export { DEFAULT_FILES } from './config.js';
export { normalizeServerName, parseProjectFile, ProjectFileError } from './project-file.js';
export { mountProjectServers } from './mount.js';
/** Cordis 插件名，用于 Loader 诊断。 */
export const name = 'workspace-mcp';
/**
 * 插件激活入口：注册 agent 创建时的项目级 MCP 挂载。
 *
 * @param ctx - 插件上下文；其 fiber 拥有本插件注册的所有资源。
 * @param config - 已由 {@link Config} 校验并填充默认值的配置。
 */
export function apply(ctx, config) {
    if (!config.enabled)
        return;
    // 每个 agent 已挂载的 fiber；agent 销毁时作用域会自行释放，这里只保留插件卸载时的兜底。
    const mounted = new Map();
    // 插件卸载（含 HMR 重载）时主动断开所有仍在运行的连接。
    ctx.effect(() => async () => {
        const fibers = [...mounted.values()].flat();
        mounted.clear();
        await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
    });
    ctx.on('agent/created', async ({ agent }) => {
        const fibers = [];
        mounted.set(agent, fibers);
        await mountProjectServers(agent.session, config, {
            plugin: async (clientConfig) => {
                const fiber = await agent.ctx.plugin(McpClient, clientConfig);
                fibers.push(fiber);
                return fiber;
            },
            log: (level, message) => {
                // 组合里没有 logger 服务时静默降级，日志问题不应影响挂载。
                ctx.logger?.[level]?.(message);
            },
        });
    });
    // agent 销毁后丢弃记录，避免长期运行时无限增长。
    ctx.on('agent/disposed', ({ agent }) => {
        mounted.delete(agent);
    });
}
