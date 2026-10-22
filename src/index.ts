/**
 * `dsh-workspace-mcp` 插件入口。
 *
 * 监听 `agent/created`，在 agent 发布后、首轮工作开始前，把会话工作目录下的
 * 项目级 MCP 配置挂载到该 agent 的作用域。挂载是 agent 作用域的副作用：
 * agent 销毁时自动断开连接并移除工具，插件卸载时也会主动释放。
 *
 * @module dsh-workspace-mcp
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { Config, type WorkspaceMcpConfig } from './config.js'
import { mountProjectServers } from './mount.js'

export { Config }
export type { WorkspaceMcpConfig }
export { DEFAULT_FILES } from './config.js'
export { matchesEnvPattern } from './env.js'
export type { VariableSource } from './env.js'
export { normalizeServerName, parseProjectFile, ProjectFileError } from './project-file.js'
export type { McpClientConfig, McpServerDeclaration, ProjectFileIssue } from './project-file.js'
export { MAX_PROJECT_FILE_BYTES, mountProjectServers, StartupTimeoutError } from './mount.js'
export type { MountFailure, MountHost, MountIo, MountResult } from './mount.js'

/** Cordis 插件名，用于 Loader 诊断。 */
export const name = 'workspace-mcp'

/**
 * 插件激活入口：注册 agent 创建时的项目级 MCP 挂载。
 *
 * @param ctx - 插件上下文；其 fiber 拥有本插件注册的所有资源。
 * @param config - 已由 {@link Config} 校验并填充默认值的配置。
 */
export function apply(ctx: Context, config: WorkspaceMcpConfig): void {
  if (!config.enabled) return

  // 每个 agent 已挂载的 fiber；agent 销毁时作用域会自行释放，这里只保留插件卸载时的兜底。
  const mounted = new Map<object, Fiber[]>()

  // 插件卸载（含 HMR 重载）时主动断开所有仍在运行的连接。
  ctx.effect(() => async () => {
    const fibers = [...mounted.values()].flat()
    mounted.clear()
    await Promise.allSettled(fibers.map((fiber) => fiber.dispose()))
  })

  ctx.on('agent/created', async ({ agent }) => {
    const fibers: Fiber[] = []
    mounted.set(agent, fibers)
    try {
      await mountProjectServers(agent.session, config, {
        plugin: async (clientConfig) => {
          // 同步登记 fiber：即使挂载还没结算插件就被卸载，清理也能覆盖到这次连接。
          const fiber = agent.ctx.plugin(McpClient, clientConfig)
          fibers.push(fiber)
          return fiber
        },
        log: (level, message) => {
          // 组合里没有 logger 服务时静默降级，日志问题不应影响挂载。
          ctx.logger?.[level]?.(message)
        },
      })
    } catch (error) {
      // 只有显式打开 failOnStartupError 才允许让会话创建失败；其余异常兜底成告警。
      if (config.failOnStartupError) throw error
      ctx.logger?.warn?.(`workspace-mcp: unexpected mount failure: ${describeError(error)}`)
    }
  })

  // agent 销毁后丢弃记录，避免长期运行时无限增长。
  ctx.on('agent/disposed', ({ agent }) => {
    mounted.delete(agent)
  })
}

/** 把任意错误值转成一行可读文本。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
