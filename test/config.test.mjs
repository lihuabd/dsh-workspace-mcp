import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Config, DEFAULT_FILES } from '../lib/config.js'

describe('Config', () => {
  it('填充默认值', () => {
    const config = Config({})
    assert.deepEqual(config.files, [...DEFAULT_FILES])
    // 默认优先 DSH 原生配置，兼容文件只作为回退。
    assert.deepEqual(config.files, ['.dsh/mcp.json', '.mcp.json'])
    assert.equal(config.enabled, true)
    assert.equal(config.startupTimeoutMs, 20000)
    assert.equal(config.toolCallTimeoutMs, 60000)
    assert.deepEqual(config.envAllowlist, [])
  })

  it('toolCallTimeoutMs 不接受 0', () => {
    assert.throws(() => Config({ toolCallTimeoutMs: 0 }), />= 1/)
  })

  it('envAllowlist 接受精确名与前缀模式', () => {
    const config = Config({ envAllowlist: ['TOKEN', 'MCP_*'] })
    assert.deepEqual(config.envAllowlist, ['TOKEN', 'MCP_*'])
  })
})
