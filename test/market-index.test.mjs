import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const roots = []
after(() => {
  for (const entry of roots) rmSync(entry, { recursive: true, force: true })
})

describe('build-market-index', () => {
  it('本地模式生成的索引能被官方校验器接受', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-market-'))
    roots.push(dir)
    const output = join(dir, 'index.json')
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'scripts/build-market-index.mjs'),
        '--local',
        '--output',
        output,
        '--url',
        'https://example.github.io/dsh-workspace-mcp/index.json',
        '--now',
        '1790000000',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)

    const index = JSON.parse(readFileSync(output, 'utf8'))
    const parsed = parseMarketIndex(index, 'https://example.github.io/dsh-workspace-mcp/index.json')
    assert.equal(parsed.plugins[0].name, pkg.name)
    assert.equal(parsed.plugins[0].versions[0].version, pkg.version)
    assert.equal(parsed.plugins[0].versions[0].engines.dsh, pkg.engines.dsh)
    // 相对图标由读取器解析为索引旁的绝对 URL
    assert.equal(parsed.plugins[0].icon, 'https://example.github.io/dsh-workspace-mcp/icon.svg')
    // 相对图标必须随索引一起发布
    assert.ok(existsSync(join(dir, 'icon.svg')))
  })

  it('未知参数以非零状态退出', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/build-market-index.mjs'), '--nope'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /未知参数/)
  })
})
