#!/usr/bin/env node
/**
 * 生成 DSH 插件市场索引（format 1）。
 *
 * 插件市场的安装来源是 npm 包或 Git 仓库；本脚本读取 npm registry 上本包的
 * 已发布版本，写出 `index.json` 并把图标放到同一目录，随后用官方校验器
 * `@deepseek-ai/dsh-plugin-market-index` 校验整份索引。
 *
 * 用法：
 *   node scripts/build-market-index.mjs --output site/index.json
 *   node scripts/build-market-index.mjs --output site/index.json --local
 *   node scripts/build-market-index.mjs --output site/index.json --url https://example.github.io/dsh-workspace-mcp/index.json
 *
 * `--local` 不访问 registry，用本地 package.json 造一个版本条目，便于发版前演练与测试。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const locale = (language) =>
  JSON.parse(readFileSync(join(root, 'locale', `${language}.json`), 'utf8')).meta

/**
 * 解析命令行参数；未知参数直接报错，避免静默忽略拼写错误。
 *
 * @param {string[]} argv - 进程参数。
 * @returns {{output: string, url: string, registry: string, local: boolean, now?: number}}
 */
function parseArgs(argv) {
  const options = {
    output: 'site/index.json',
    url: 'https://example.invalid/index.json',
    registry: 'https://registry.npmjs.org/',
    local: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--local') {
      options.local = true
    } else if (flag === '--output' || flag === '--url' || flag === '--registry' || flag === '--now') {
      if (value === undefined) throw new Error(`${flag} 需要一个值`)
      index += 1
      if (flag === '--output') options.output = value
      else if (flag === '--url') options.url = value
      else if (flag === '--registry') options.registry = value
      else options.now = Number(value)
    } else {
      throw new Error(`未知参数: ${flag}`)
    }
  }
  return options
}

/**
 * 拉取 registry 上的包文档，失败时有限次重试（npm 发布后索引通常有几秒延迟）。
 *
 * @param {string} registry - registry 根地址。
 * @param {string} name - 包名。
 * @returns {Promise<any>} registry 文档。
 */
async function fetchRegistry(registry, name) {
  const url = new URL(encodeURIComponent(name), registry)
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (response.ok) return await response.json()
      lastError = new Error(`GET ${url} -> ${response.status}`)
      if (response.status === 404) break
    } catch (error) {
      lastError = error
    }
    await new Promise((done) => setTimeout(done, 2000 * (attempt + 1)))
  }
  throw lastError ?? new Error(`无法读取 ${url}`)
}

/**
 * 从 registry 文档提取可上市版本：未弃用、声明了 `dsh.bundle`、有 `engines.dsh` 与发布时间。
 *
 * @param {any} document - registry 文档。
 * @returns {Array<{version: string, publishTimestamp: number, source: object, engines: {dsh: string}}>}
 */
function versionsFromRegistry(document) {
  const versions = []
  for (const [version, manifest] of Object.entries(document.versions ?? {})) {
    if (manifest.deprecated !== undefined) continue
    if (manifest.dsh?.bundle === undefined) continue
    const engine = manifest.engines?.dsh
    if (typeof engine !== 'string' || engine.trim() === '') continue
    const published = document.time?.[version]
    if (typeof published !== 'string') continue
    versions.push({
      version,
      publishTimestamp: Math.floor(Date.parse(published) / 1000),
      source: { type: 'npm' },
      engines: { dsh: engine.trim() },
    })
  }
  if (versions.length === 0) throw new Error(`${document.name} 没有可上市的版本（需要 dsh.bundle 与 engines.dsh）`)
  return versions
}

/**
 * 用本地 manifest 造一个版本条目，用于未发布时的演练与单元测试。
 *
 * @param {number} now - 当前 Unix 秒。
 * @returns {Array<{version: string, publishTimestamp: number, source: object, engines: {dsh: string}}>}
 */
function versionsFromLocal(now) {
  const engine = pkg.engines?.dsh
  if (typeof engine !== 'string' || engine.trim() === '') throw new Error('package.json 缺少 engines.dsh')
  return [{ version: pkg.version, publishTimestamp: now, source: { type: 'npm' }, engines: { dsh: engine.trim() } }]
}

/** 从 package.json 取展示字段，缺失时省略而不是写空值。 */
function displayFields() {
  const english = locale('en')
  const chinese = locale('zh')
  const plugin = {
    name: pkg.name,
    title: { en: english.title, zh: chinese.title },
    description: { en: english.description, zh: chinese.description },
    // 相对图标随索引一起发布，脚本会把它复制到输出目录
    icon: 'icon.svg',
  }
  if (typeof pkg.author === 'string' && pkg.author.trim() !== '') {
    plugin.author = pkg.author.replace(/\s*<[^>]*>|\s*\([^)]*\)/g, '').trim()
  }
  if (typeof pkg.homepage === 'string') plugin.homepage = pkg.homepage
  if (pkg.repository !== undefined) {
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url
    if (typeof url === 'string') plugin.repository = { url: url.replace(/^git\+/, '').replace(/\.git$/, '') }
  }
  if (Array.isArray(pkg.keywords) && pkg.keywords.length > 0) plugin.metadata = { keywords: pkg.keywords }
  return plugin
}

/** 保留只指向已列出版本的 dist-tags。 */
function distTags(document, listed) {
  const tags = {}
  for (const [tag, version] of Object.entries(document?.['dist-tags'] ?? {})) {
    if (listed.has(version)) tags[tag] = version
  }
  return tags
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const now = options.now ?? Math.floor(Date.now() / 1000)

  let versions
  let tags = {}
  if (options.local) {
    versions = versionsFromLocal(now)
    tags = { latest: pkg.version }
  } else {
    const document = await fetchRegistry(options.registry, pkg.name)
    versions = versionsFromRegistry(document)
    tags = distTags(document, new Set(versions.map((entry) => entry.version)))
  }

  const plugin = displayFields()
  if (Object.keys(tags).length > 0) plugin['dist-tags'] = tags
  plugin.versions = versions

  const index = {
    format: 1,
    title: { en: 'dsh-workspace-mcp', zh: 'dsh-workspace-mcp' },
    description: {
      en: 'Project-level MCP servers for DeepSeek Harness.',
      zh: 'DeepSeek Harness 的项目级 MCP 服务器。',
    },
    plugins: [plugin],
  }

  // 官方校验器是发布前的最后一道关：格式错误会带 JSON 路径抛出。
  parseMarketIndex(index, options.url)

  const output = resolve(root, options.output)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(index, null, 2)}\n`)
  copyFileSync(join(root, 'icon.svg'), join(dirname(output), 'icon.svg'))
  console.log(`wrote ${output} (${versions.length} version(s), ${Object.keys(tags).join(', ') || 'no dist-tags'})`)
}

main().catch((error) => {
  console.error(`build-market-index: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
