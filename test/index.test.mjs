import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 创建测试用临时目录。 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-workspace-mcp-index-'))
  roots.push(dir)
  return dir
}

/** 等待一轮宏任务，让监听器里的异步挂载结算。 */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 构造完整配置。 */
function config(overrides = {}) {
  return {
    enabled: true,
    files: ['.mcp.json'],
    searchParents: false,
    maxParentDepth: 3,
    includeSubagents: false,
    failOnStartupError: false,
    startupTimeoutMs: 20000,
    toolCallTimeoutMs: 60000,
    env: {},
    envAllowlist: [],
    ...overrides,
  }
}

/**
 * 构造一个记录挂载调用、可手动释放的 agent 作用域。
 *
 * `ctx.plugin` 返回的对象模仿 Cordis 的 `Fiber & PromiseLike<Fiber>`：既同步可登记，
 * 又能在 await 时结算（或按 `options.fail` 拒绝）。
 */
function fakeAgent(dir, options = {}) {
  const calls = []
  const disposed = []
  const agent = {
    session: { header: { cwd: dir, ...(options.header ?? {}) } },
    ctx: {
      plugin: (mounted, clientConfig) => {
        calls.push(clientConfig)
        // await 必须结算到「非 thenable」的目标，否则会无限自我采纳。
        const target = {
          dispose: async () => {
            disposed.push(clientConfig.serverName)
          },
        }
        return {
          ...target,
          then: (onFulfilled, onRejected) => {
            const settle = new Promise((resolve, reject) => {
              setTimeout(() => {
                if (options.fail) reject(new Error('mcp down'))
                else resolve(target)
              }, options.delayMs ?? 0)
            })
            return settle.then(onFulfilled, onRejected)
          },
        }
      },
    },
  }
  return { agent, calls, disposed }
}

describe('plugin entry', () => {
  it('在 agent/created 时把项目文件挂到该 agent 作用域', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { demo: { command: 'node', args: ['server.js'] } } }),
    )
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config())
    const { agent, calls } = fakeAgent(dir)

    // 用 serial 而不是 emit：真实链路会在释放首轮工作前等待监听器结算。
    await ctx.serial('agent/created', { agent })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].serverName, 'demo')
    assert.equal(calls[0].cwd, dir)
    await fiber.dispose()
  })

  it('卸载插件时释放仍在运行的挂载', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'x' } } }))
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config())
    const { agent, disposed } = fakeAgent(dir)

    ctx.emit('agent/created', { agent })
    await tick()
    await fiber.dispose()

    assert.deepEqual(disposed, ['demo'])
  })

  it('enabled 为 false 时不注册任何监听', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'x' } } }))
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config({ enabled: false }))
    const { agent, calls } = fakeAgent(dir)

    ctx.emit('agent/created', { agent })
    await tick()

    assert.equal(calls.length, 0)
    await fiber.dispose()
  })

  it('服务器连接失败不会让 agent 创建失败', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'x' } } }))
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config())
    const { agent } = fakeAgent(dir, { fail: true })

    // 默认 failOnStartupError 为 false：监听器吞掉挂载错误，创建派发正常结算。
    await assert.doesNotReject(() => ctx.serial('agent/created', { agent }))
    await fiber.dispose()
  })

  it('failOnStartupError 为 true 时让创建派发失败', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'x' } } }))
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config({ failOnStartupError: true }))
    const { agent } = fakeAgent(dir, { fail: true })

    await assert.rejects(() => ctx.serial('agent/created', { agent }), /failed to start/)
    await fiber.dispose()
  })

  it('挂载进行中卸载插件也会释放后创建的连接', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'x' } } }))
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, config())
    const { agent, disposed } = fakeAgent(dir, { delayMs: 50 })

    // emit 会同步跑到 agent.ctx.plugin：fiber 在结算前就已登记。
    ctx.emit('agent/created', { agent })
    await fiber.dispose()

    assert.deepEqual(disposed, ['demo'])
  })
})
