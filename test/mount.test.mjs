import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { DEFAULT_FILES } from '../lib/config.js'
import { MAX_PROJECT_FILE_BYTES, mountProjectServers } from '../lib/mount.js'

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
    startupTimeoutMs: 20000,
    toolCallTimeoutMs: 60000,
    env: {},
    envAllowlist: [],
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

  it('默认读取 .dsh/mcp.json', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.dsh'))
    writeFileSync(
      join(dir, '.dsh/mcp.json'),
      JSON.stringify({ mcpServers: { native: { command: 'x' } } }),
    )
    const result = await mountProjectServers(session(dir), config(), host())

    assert.equal(result.file, join(dir, '.dsh/mcp.json'))
    assert.deepEqual(result.mounted, ['native'])
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

  it('单个服务器字段不合法时只跳过该条目', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: { good: { command: 'x' }, bad: { command: 'y', args: [1] } },
      }),
    )
    const mountHost = host()
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.deepEqual(result.mounted, ['good'])
    assert.deepEqual(result.failed.map((entry) => entry.server), ['bad'])
  })

  it('并发启动服务器，而不是逐台等待', async () => {
    const dir = tempDir()
    const names = ['a', 'b', 'c']
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: Object.fromEntries(names.map((name) => [name, { command: 'x' }])),
      }),
    )
    const mountHost = {
      plugin: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { dispose: async () => {} }
      },
      log: () => {},
    }

    const start = Date.now()
    const result = await mountProjectServers(session(dir), config(), mountHost)
    const elapsed = Date.now() - start

    assert.deepEqual(result.mounted, names)
    // 串行需要约 300ms；并发只需要一个 100ms 的窗口，留足 CI 抖动余量。
    assert.ok(elapsed < 250, `elapsed ${elapsed}ms`)
  })

  it('启动预算耗尽时记录失败并继续，不阻塞会话', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { slow: { command: 'x' } } }))
    const mountHost = {
      plugin: () => new Promise(() => {}),
      log: () => {},
    }

    const start = Date.now()
    const result = await mountProjectServers(
      session(dir),
      config({ startupTimeoutMs: 50 }),
      mountHost,
    )

    assert.deepEqual(result.mounted, [])
    assert.equal(result.failed.length, 1)
    assert.match(result.failed[0].message, /启动超过/)
    assert.ok(Date.now() - start < 1000)
  })

  it('failOnStartupError 为 true 时把启动失败升级为抛出', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { broken: { command: 'x' }, ok: { command: 'y' } } }),
    )

    await assert.rejects(
      mountProjectServers(
        session(dir),
        config({ failOnStartupError: true }),
        host({ failOn: 'broken' }),
      ),
      /failed to start/,
    )
  })

  it('failOnStartupError 只升级连接失败，不升级配置错误', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { bad: { args: [1] } } }))

    const result = await mountProjectServers(
      session(dir),
      config({ failOnStartupError: true }),
      host(),
    )
    assert.deepEqual(result.mounted, [])
    assert.equal(result.failed.length, 1)
  })

  it('searchParents 控制向上查找，父目录命中时以配置文件目录为 cwd', async () => {
    const root = tempDir()
    const child = join(root, 'nested')
    mkdirSync(child)
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { up: { command: 'x' } } }))

    const without = await mountProjectServers(session(child), config(), host())
    assert.equal(without.mounted.length, 0)

    const mountHost = host()
    const withParents = await mountProjectServers(
      session(child),
      config({ searchParents: true }),
      mountHost,
    )
    assert.deepEqual(withParents.mounted, ['up'])
    // 相对 cwd/args 以配置文件所在目录为基准，而不是会话子目录。
    assert.equal(mountHost.calls[0].cwd, root)
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

  it('默认不展开进程环境变量，并告警变量名', async () => {
    process.env.WSMCP_TEST_TOKEN = 'host-secret'
    try {
      const dir = tempDir()
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { a: { command: 'x', env: { T: '${WSMCP_TEST_TOKEN}' } } } }),
      )
      const mountHost = host()
      await mountProjectServers(session(dir), config(), mountHost)

      assert.equal(mountHost.calls[0].env.T, '')
      assert.ok(
        mountHost.logs.some(
          (entry) => entry.level === 'warn' && /WSMCP_TEST_TOKEN/.test(entry.message),
        ),
      )
    } finally {
      delete process.env.WSMCP_TEST_TOKEN
    }
  })

  it('envAllowlist 命中后才展开进程环境变量', async () => {
    process.env.WSMCP_TEST_TOKEN = 'host-secret'
    try {
      const dir = tempDir()
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { a: { command: 'x', env: { T: '${WSMCP_TEST_TOKEN}' } } } }),
      )
      const mountHost = host()
      await mountProjectServers(session(dir), config({ envAllowlist: ['WSMCP_*'] }), mountHost)

      assert.equal(mountHost.calls[0].env.T, 'host-secret')
      assert.ok(
        !mountHost.logs.some(
          (entry) => entry.level === 'warn' && /WSMCP_TEST_TOKEN/.test(entry.message),
        ),
      )
    } finally {
      delete process.env.WSMCP_TEST_TOKEN
    }
  })

  it('审计日志记录展开前的命令，不泄露变量值', async () => {
    process.env.WSMCP_AUDIT_TOKEN = 'super-secret'
    try {
      const dir = tempDir()
      writeFileSync(
        join(dir, '.mcp.json'),
        JSON.stringify({
          mcpServers: { audit: { command: 'node', args: ['--token', '${WSMCP_AUDIT_TOKEN}'] } },
        }),
      )
      const mountHost = host()
      await mountProjectServers(session(dir), config({ envAllowlist: ['WSMCP_*'] }), mountHost)

      const logs = mountHost.logs.map((entry) => entry.message).join('\n')
      assert.match(logs, /starting "audit": stdio node/)
      assert.match(logs, /\$\{WSMCP_AUDIT_TOKEN\}/)
      assert.ok(!logs.includes('super-secret'))
    } finally {
      delete process.env.WSMCP_AUDIT_TOKEN
    }
  })

  it('同一目录优先 .dsh/mcp.json，并告警被忽略的 .mcp.json', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.dsh'))
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    writeFileSync(join(dir, '.dsh/mcp.json'), JSON.stringify({ mcpServers: { b: { command: 'y' } } }))

    const mountHost = host()
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.equal(result.file, join(dir, '.dsh/mcp.json'))
    assert.deepEqual(result.mounted, ['b'])
    assert.ok(
      mountHost.logs.some(
        (entry) => entry.level === 'warn' && entry.message.includes(join(dir, '.mcp.json')),
      ),
    )
  })

  it('拒绝超过大小上限的项目文件', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.mcp.json'), 'x'.repeat(MAX_PROJECT_FILE_BYTES + 1))

    const mountHost = host()
    const result = await mountProjectServers(session(dir), config(), mountHost)

    assert.deepEqual(result.mounted, [])
    assert.ok(mountHost.logs.some((entry) => entry.level === 'warn' && /上限/.test(entry.message)))
  })
})
