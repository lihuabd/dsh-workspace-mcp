import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('package manifest', () => {
  it('声明 DSH bundle 契约与兼容范围', () => {
    assert.equal(pkg.dsh?.manifestVersion, 1)
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
    assert.equal(typeof pkg.engines?.dsh, 'string')
    assert.ok(pkg.engines.dsh.length > 0)
  })

  it('导出 locale、icon 与运行时入口', () => {
    assert.equal(pkg.exports?.['.']?.default, './lib/index.js')
    assert.equal(pkg.exports?.['./locale/*.json'], './locale/*.json')
    assert.equal(pkg.exports?.['./icon'], './icon.svg')
    assert.equal(pkg.icon, './icon.svg')
  })

  it('把显示资源与运行时文件放进 files', () => {
    for (const entry of [
      'cordis.patch.yml',
      'icon.svg',
      'locale/*.json',
      'lib/**/*.js',
      'lib/types/**/*.d.ts',
      'README.md',
      'LICENSE',
    ]) {
      assert.ok(pkg.files.includes(entry), `files 缺少 ${entry}`)
    }
  })

  it('locale 提供英文回退与中文显示元数据', () => {
    for (const language of ['en', 'zh']) {
      const meta = JSON.parse(
        readFileSync(join(root, 'locale', `${language}.json`), 'utf8'),
      ).meta
      assert.ok(meta.title.length > 0, `${language}.title`)
      assert.ok(meta.description.length > 0, `${language}.description`)
    }
  })

  it('图标是包内文件且不超过 256 KiB', () => {
    const icon = join(root, pkg.icon)
    assert.ok(statSync(icon).isFile())
    assert.ok(statSync(icon).size <= 256 * 1024)
  })

  it('不通过 install/postinstall 脚本获得执行', () => {
    assert.equal(pkg.scripts?.install, undefined)
    assert.equal(pkg.scripts?.postinstall, undefined)
  })
})
