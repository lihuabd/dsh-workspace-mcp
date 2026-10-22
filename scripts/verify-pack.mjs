#!/usr/bin/env node
/**
 * 校验 npm 实际打包清单包含 DSH bundle 所需的运行时与显示资源。
 *
 * 官方发布要求检查 packed file list：patch、locale、icon 与全部运行时文件
 * 必须真的进入 tarball，而不是只存在于仓库里。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** 递归列出目录中的文件，返回相对 root 的 POSIX 路径。 */
function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(relative(root, full).split(sep).join('/'))
  }
  return files
}

/** 构造必须出现在 tarball 里的路径集合。 */
function requiredFiles() {
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') throw new Error('package.json 缺少 dsh.bundle.patch')
  const required = new Set([
    'package.json',
    'README.md',
    'LICENSE',
    'cordis.patch.yml',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
  ])
  required.add(patch.replace(/^\.\//, ''))
  if (typeof pkg.icon === 'string') required.add(pkg.icon.replace(/^\.\//, ''))

  const lib = join(root, 'lib')
  if (!existsSync(lib)) throw new Error('lib/ 不存在；请先运行构建')
  for (const file of listFiles(lib)) {
    if (file.endsWith('.js') || file.endsWith('.d.ts')) required.add(file)
  }
  return required
}

/** 运行 npm pack --dry-run，返回实际打包路径集合。 */
function packedFiles() {
  const cache = mkdtempSync(join(tmpdir(), 'dsh-pack-cache-'))
  try {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const result = spawnSync(command, ['pack', '--dry-run', '--json', '--cache', cache], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(`npm pack --dry-run 失败${detail.length > 0 ? `:\n${detail}` : ''}`)
    }

    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`无法解析 npm pack 输出: ${detail}`)
    }
    const entry = Array.isArray(parsed) ? parsed[0] : undefined
    if (entry === undefined || !Array.isArray(entry.files)) {
      throw new Error('npm pack 输出中没有 files 列表')
    }
    return new Set(entry.files.map((file) => file.path))
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
}

try {
  const required = requiredFiles()
  const packed = packedFiles()
  const missing = [...required].filter((file) => !packed.has(file)).sort()
  if (missing.length > 0) {
    console.error('verify-pack: tarball 缺少必需文件:')
    for (const file of missing) console.error(`  - ${file}`)
    process.exitCode = 1
  } else {
    console.log(`verify-pack: ${packed.size} packed files, ${required.size} required paths present`)
  }
} catch (error) {
  console.error(`verify-pack: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
