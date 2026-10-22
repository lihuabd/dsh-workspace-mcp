import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { expandVariables } from '../lib/env.js'
import {
  findProjectFile,
  normalizeServerName,
  parseProjectFile,
  ProjectFileError,
  toClientConfig,
} from '../lib/project-file.js'

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** 创建一个测试用的临时目录。 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-workspace-mcp-'))
  roots.push(dir)
  return dir
}

describe('expandVariables', () => {
  it('展开已定义的变量', () => {
    assert.equal(expandVariables('${TOKEN}/x', { TOKEN: 'abc' }), 'abc/x')
  })

  it('未定义且无默认值时展开为空串', () => {
    assert.equal(expandVariables('a${MISSING}b', {}), 'ab')
  })

  it('未定义时使用默认值', () => {
    assert.equal(expandVariables('${MISSING:-fallback}', {}), 'fallback')
  })

  it('已定义时忽略默认值', () => {
    assert.equal(expandVariables('${TOKEN:-fallback}', { TOKEN: 'real' }), 'real')
  })

  it('保留不认识的写法', () => {
    assert.equal(expandVariables('${1BAD} $PLAIN', {}), '${1BAD} $PLAIN')
  })
})

describe('normalizeServerName', () => {
  it('合法名字原样返回', () => {
    assert.equal(normalizeServerName('cc-tools_prod'), 'cc-tools_prod')
  })

  it('非法字符被规范化并追加哈希', () => {
    const name = normalizeServerName('my server!')
    assert.match(name, /^[A-Za-z0-9_-]{1,32}$/)
    assert.notEqual(name, 'my server!')
  })

  it('不同原名不会折叠成同一个名字', () => {
    assert.notEqual(normalizeServerName('a b'), normalizeServerName('a/b'))
  })

  it('超长名字被截断到 32 个字符', () => {
    assert.ok(normalizeServerName('x'.repeat(80)).length <= 32)
  })
})

describe('parseProjectFile', () => {
  it('解析 stdio 与 http 声明', () => {
    const file = parseProjectFile(
      JSON.stringify({
        mcpServers: {
          local: { command: 'node', args: ['server.js'], env: { A: '1' } },
          remote: { type: 'http', url: 'https://example.com/mcp', headers: { X: 'y' } },
        },
      }),
      '/tmp/.mcp.json',
    )
    assert.deepEqual(Object.keys(file.servers), ['local', 'remote'])
    assert.equal(file.servers.local.command, 'node')
    assert.equal(file.servers.remote.type, 'http')
  })

  it('没有 mcpServers 时返回空集合', () => {
    assert.deepEqual(parseProjectFile('{}', '/tmp/.mcp.json').servers, {})
  })

  it('非法 JSON 抛出 ProjectFileError', () => {
    assert.throws(() => parseProjectFile('{', '/tmp/.mcp.json'), ProjectFileError)
  })

  it('mcpServers 不是对象时抛出', () => {
    assert.throws(() => parseProjectFile('{"mcpServers": []}', '/tmp/.mcp.json'), ProjectFileError)
  })

  it('args 里有非字符串时抛出', () => {
    assert.throws(
      () => parseProjectFile('{"mcpServers":{"x":{"command":"n","args":[1]}}}', '/tmp/.mcp.json'),
      ProjectFileError,
    )
  })
})

describe('toClientConfig', () => {
  const options = { variables: { TOKEN: 'secret' }, failOnStartupError: false, toolCallTimeoutMs: 1234 }

  it('stdio 默认使用项目目录与全局超时', () => {
    const config = toClientConfig('local', { command: 'node', args: ['a.js'] }, '/repo', options)
    assert.equal(config.transport, 'stdio')
    assert.equal(config.cwd, '/repo')
    assert.equal(config.toolCallTimeoutMs, 1234)
    assert.deepEqual(config.args, ['a.js'])
  })

  it('stdio 的 cwd 相对项目目录解析', () => {
    const config = toClientConfig('local', { command: 'node', cwd: 'tools' }, '/repo', options)
    assert.equal(config.cwd, '/repo/tools')
  })

  it('展开 env 与 headers 中的变量', () => {
    const stdio = toClientConfig('local', { command: 'node', env: { T: '${TOKEN}' } }, '/repo', options)
    assert.equal(stdio.env.T, 'secret')
    const http = toClientConfig(
      'remote',
      { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
      '/repo',
      options,
    )
    assert.equal(http.transport, 'streamable-http')
    assert.equal(http.headers.Authorization, 'Bearer secret')
  })

  it('单台服务器可以覆盖超时', () => {
    const config = toClientConfig('local', { command: 'node', toolCallTimeoutMs: 9 }, '/repo', options)
    assert.equal(config.toolCallTimeoutMs, 9)
  })

  it('缺少 command 与 url 时抛出', () => {
    assert.throws(() => toClientConfig('broken', {}, '/repo', options), ProjectFileError)
  })

  it('拒绝 SSE 传输', () => {
    assert.throws(
      () => toClientConfig('sse', { type: 'sse', url: 'https://x.example/sse' }, '/repo', options),
      /SSE/,
    )
  })

  it('拒绝非 http(s) 的 url', () => {
    assert.throws(
      () => toClientConfig('bad', { type: 'http', url: 'ftp://x.example/mcp' }, '/repo', options),
      ProjectFileError,
    )
  })
})

describe('findProjectFile', () => {
  it('命中当前目录的第一个候选文件', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'b.json'), '{}')
    writeFileSync(join(dir, 'a.json'), '{}')
    assert.equal(findProjectFile(dir, ['a.json', 'b.json'], 0, existsSync), join(dir, 'a.json'))
  })

  it('当前目录没有时按层数向上查找', () => {
    const root = tempDir()
    const child = join(root, 'a', 'b')
    mkdirSync(child, { recursive: true })
    writeFileSync(join(root, '.mcp.json'), '{}')
    assert.equal(findProjectFile(child, ['.mcp.json'], 0, existsSync), undefined)
    assert.equal(findProjectFile(child, ['.mcp.json'], 2, existsSync), join(root, '.mcp.json'))
  })

  it('到达文件系统根后停止', () => {
    assert.equal(findProjectFile('/', ['.never-exists-xyz'], 8, existsSync), undefined)
  })
})
