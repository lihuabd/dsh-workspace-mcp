import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { DEFAULT_FILES } from '../lib/config.js'
import { mountProjectServers } from '../lib/mount.js'

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 创建测试用临时目录。 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-workspace-mcp-mount-'))
  roots.push(dir)
  return dir
}

/** 构造完整的插件配置，测试只覆盖关心的字段。 */
function config(overrides = {}) {
  return {
    enabled: true,
    files: [...DEFAULT_FILES],
    searchParents: false,
    maxParentDepth: 3,
    includeSubagents: false,
    failOnStartupError: false,
    toolCallTimeoutMs: 60000,
    env: {},
    ...overrides,
  }
}

/** 构造最小会话。 */
function session(cwd, header = {}) {
  return { header: { cwd, ...header } }
}

/** 收集挂载与日志的宿主。 */
function host(options = {}) {
  const calls = []
  const logs = []
  const failOn = options.failOn
  return {
    calls,
    logs,
    plugin: async (clientConfig) => {
      calls.push(clientConfig)
      if (clientConfig.serverName === failOn) throw new Error('boom')
      return { dispose: async () => {} }
    },
    log: (level, message) => logs.push({ level, message }),
  }
}

describe('mountProjectServers', () => {
  it('挂载项目文件中的全部服务器', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          local: { command: 'node', args: ['server.js'] },
          remote: { type: 'http', url: 'https://example.com/mcp' },
        },
      }),
    )
    const mountHost = host()
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.equal(result.file, join(dir, '.mcp.json'))
    assert.deepEqual(result.mounted, ['local', 'remote'])
    assert.deepEqual(result.failed, [])
    assert.equal(mountHost.calls.length, 2)
    assert.equal(mountHost.calls[0].transport, 'stdio')
    assert.equal(mountHost.calls[0].cwd, dir)
    assert.equal(mountHost.calls[1].transport, 'streamable-http')
  })

  it('没有配置文件时什么也不做', async () => {
    const mountHost = host()
    const result = await mountProjectServers(session(tempDir()), config(), mountHost)
    assert.deepEqual(result, { mounted: [], failed: [] })
    assert.equal(mountHost.calls.length, 0)
  })

  it('没有会话目录时什么也不做', async () => {
    const mountHost = host()
    const result = await mountProjectServers({ header: {} }, config(), mountHost)
    assert.deepEqual(result, { mounted: [], failed: [] })
  })

  it('默认跳过子 agent', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const mountHost = host()

    const skipped = await mountProjectServers(session(dir, { origin: 'subagent' }), config(), mountHost)
    assert.equal(skipped.mounted.length, 0)

    const included = await mountProjectServers(
      session(dir, { origin: 'subagent' }),
      config({ includeSubagents: true }),
      host(),
    )
    assert.deepEqual(included.mounted, ['a'])
  })

  it('跳过 disabled 的服务器', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: { off: { command: 'x', disabled: true }, on: { command: 'y' } },
      }),
    )
    const result = await mountProjectServers(session(dir), config(), host())
    assert.deepEqual(result.mounted, ['on'])
  })

  it('单台服务器失败不影响其余服务器，也不抛出', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: { broken: { command: 'x' }, ok: { command: 'y' } },
      }),
    )
    const mountHost = host({ failOn: 'broken' })
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.deepEqual(result.mounted, ['ok'])
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].server, 'broken')
    assert.ok(mountHost.logs.some((entry) => entry.level === 'warn' && /broken/.test(entry.message)))
  })

  it('项目文件损坏时记录告警并跳过', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), '{')
    const mountHost = host()
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.deepEqual(result.mounted, [])
    assert.deepEqual(result.failed, [])
    assert.equal(mountHost.logs.length, 1)
    assert.equal(mountHost.logs[0].level, 'warn')
  })

  it('searchParents 控制向上查找', async () => {
    const root = tempDir()
    const child = join(root, 'nested')
    mkdirSync(child)
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { up: { command: 'x' } } }))

    const without = await mountProjectServers(session(child), config(), host())
    assert.equal(without.mounted.length, 0)

    const withParents = await mountProjectServers(
      session(child),
      config({ searchParents: true }),
      host(),
    )
    assert.deepEqual(withParents.mounted, ['up'])
  })

  it('用配置里的 env 展开占位符，并优先于进程环境', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'x', env: { T: '${TOKEN}' } } } }),
    )
    const mountHost = host()
    await mountProjectServers(session(dir), config({ env: { TOKEN: 'from-config' } }), mountHost)
    assert.equal(mountHost.calls[0].env.T, 'from-config')
  })
})
