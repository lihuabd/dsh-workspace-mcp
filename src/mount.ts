/**
 * 会话创建时的项目级 MCP 挂载流程。
 *
 * 每个 agent 创建时读取其会话工作目录下的项目配置文件，把其中每台服务器作为
 * 独立的 `dsh-mcp-client` 实例挂到该 agent 的作用域上：工具随会话销毁而移除，
 * 单台服务器失败不影响其余服务器，也不影响会话创建。
 *
 * @module dsh-workspace-mcp/mount
 */
import { existsSync, readFileSync } from 'node:fs'
import type { WorkspaceMcpConfig } from './config.js'
import {
  findProjectFile,
  parseProjectFile,
  toClientConfig,
  type McpClientConfig,
} from './project-file.js'

/** 挂载所需的最小会话信息（结构类型，避免与具体 Session 实现耦合）。 */
export interface ProjectSessionLike {
  header: {
    /** 会话创建时的绝对工作目录。 */
    cwd?: string
    /** 会话的产品分类；`subagent` 表示这是子 agent 会话。 */
    origin?: 'subagent'
  }
}

/** 挂载流程依赖的宿主能力。 */
export interface MountHost {
  /** 把一台服务器挂到当前 agent 作用域，返回可等待的挂载结果。 */
  plugin(config: McpClientConfig): Promise<unknown>
  /** 记录诊断信息。 */
  log(level: 'info' | 'warn', message: string): void
}

/** 文件系统访问，便于在测试中替换。 */
export interface MountIo {
  exists(path: string): boolean
  readFile(path: string): string
}

/** 单台服务器的挂载失败记录。 */
export interface MountFailure {
  server: string
  message: string
}

/** 一次挂载的结果；失败被收集而不是抛出。 */
export interface MountResult {
  /** 命中的项目配置文件绝对路径。 */
  file?: string
  /** 成功挂载的服务器名（项目文件里的原始名）。 */
  mounted: string[]
  /** 挂载失败的服务器。 */
  failed: MountFailure[]
}

/** 生产环境使用的文件系统实现。 */
export const nodeMountIo: MountIo = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
}

/**
 * 为一次 agent 创建挂载项目级 MCP 服务器。
 *
 * @param session - 该 agent 的会话（读取 `header.cwd` 与 `header.origin`）。
 * @param config - 插件配置。
 * @param host - 插件挂载与日志能力。
 * @param io - 文件系统访问实现，默认使用 `node:fs`。
 * @returns 命中的文件、成功的服务器与失败清单；本函数不会抛错。
 */
export async function mountProjectServers(
  session: ProjectSessionLike,
  config: WorkspaceMcpConfig,
  host: MountHost,
  io: MountIo = nodeMountIo,
): Promise<MountResult> {
  const result: MountResult = { mounted: [], failed: [] }

  const cwd = session.header?.cwd
  if (cwd === undefined || cwd.length === 0) return result
  // 子 agent 默认复用父会话的工具集，避免为每个子 agent 重复拉起服务器进程。
  if (!config.includeSubagents && session.header.origin === 'subagent') return result

  const depth = config.searchParents ? config.maxParentDepth : 0
  const file = findProjectFile(cwd, config.files, depth, io.exists)
  if (file === undefined) return result
  result.file = file

  let servers: ReturnType<typeof parseProjectFile>['servers']
  try {
    servers = parseProjectFile(io.readFile(file), file).servers
  } catch (error) {
    // 文件本身不合法时整份跳过，但只记录告警：项目文件不应阻断会话。
    host.log('warn', `workspace-mcp: cannot load ${file}: ${describeError(error)}`)
    return result
  }

  const variables = { ...process.env, ...config.env }
  for (const [name, declaration] of Object.entries(servers)) {
    if (declaration.disabled === true) continue
    try {
      const clientConfig = toClientConfig(name, declaration, cwd, {
        variables,
        failOnStartupError: config.failOnStartupError,
        toolCallTimeoutMs: config.toolCallTimeoutMs,
      })
      await host.plugin(clientConfig)
      result.mounted.push(name)
    } catch (error) {
      // 单台服务器失败只影响它自己：会话照常创建，其余服务器继续挂载。
      const message = describeError(error)
      result.failed.push({ server: name, message })
      host.log('warn', `workspace-mcp: ${file} server ${JSON.stringify(name)} not mounted: ${message}`)
    }
  }

  if (result.mounted.length > 0) {
    host.log(
      'info',
      `workspace-mcp: mounted ${result.mounted.length} server(s) from ${file}: ${result.mounted.join(', ')}`,
    )
  }
  return result
}

/** 把任意错误值转成一行可读文本。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
