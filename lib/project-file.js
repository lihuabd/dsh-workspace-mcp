/**
 * 项目级 MCP 配置文件的发现、解析与规范化。
 *
 * 文件格式沿用 Claude Code 的 `.mcp.json`：顶层 `mcpServers`，每个键是服务器名，
 * 值描述 stdio（`command`）或 Streamable HTTP（`url`）传输。本模块只做纯计算，
 * 文件系统访问由调用方注入，便于单元测试。
 *
 * @module dsh-workspace-mcp/project-file
 */
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { expandVariables } from './env.js';
/** 合法的服务器命名空间（与 dsh-mcp-client 的约束一致）。 */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** 项目文件内容不合法时抛出的可诊断错误。 */
export class ProjectFileError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ProjectFileError';
    }
}
/**
 * 把原始服务器名规范成 dsh-mcp-client 接受、且可安全用作工具名段的 namespace。
 *
 * 合法名原样返回；不合法时做有损规范化并追加 8 位哈希后缀，避免不同名字折叠成同一个。
 *
 * @param name - 项目文件里的服务器名。
 * @returns 长度不超过 32 的合法 namespace。
 */
export function normalizeServerName(name) {
    const trimmed = name.trim();
    if (SERVER_NAME.test(trimmed))
        return trimmed;
    const base = trimmed
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20) || 'server';
    const digest = createHash('sha256').update(trimmed).digest('hex').slice(0, 8);
    return `${base}_${digest}`.slice(0, 32);
}
/**
 * 在会话工作目录（可选地向父目录）查找第一个存在的项目配置文件。
 *
 * @param cwd - 会话工作目录，绝对路径。
 * @param files - 候选相对路径，按优先级排列。
 * @param maxParentDepth - 向上查找的层数；0 表示只看当前目录。
 * @param exists - 文件存在性判断，默认 `node:fs` 的实现由调用方注入。
 * @returns 命中的绝对路径，未命中返回 undefined。
 */
export function findProjectFile(cwd, files, maxParentDepth, exists) {
    const candidates = files.filter((file) => file.trim().length > 0);
    if (candidates.length === 0)
        return undefined;
    let directory = resolve(cwd);
    for (let depth = 0;; depth += 1) {
        for (const candidate of candidates) {
            const file = isAbsolute(candidate) ? candidate : resolve(directory, candidate);
            if (exists(file))
                return file;
        }
        if (depth >= maxParentDepth)
            return undefined;
        const parent = dirname(directory);
        if (parent === directory)
            return undefined;
        directory = parent;
    }
}
/**
 * 解析项目文件文本，校验 `mcpServers` 的结构并归一化字段。
 *
 * @param text - 文件内容。
 * @param source - 文件绝对路径，用于错误信息。
 * @returns 服务器名 → 声明。
 * @throws {ProjectFileError} 内容不是合法 JSON 或结构不符合约定。
 */
export function parseProjectFile(text, source) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (error) {
        throw new ProjectFileError(`${source} 不是合法 JSON`, { cause: error });
    }
    if (!isPlainObject(data))
        throw new ProjectFileError(`${source} 的顶层必须是 JSON 对象`);
    const rawServers = data.mcpServers;
    if (rawServers === undefined)
        return { file: source, servers: {} };
    if (!isPlainObject(rawServers))
        throw new ProjectFileError(`${source} 的 mcpServers 必须是对象`);
    const servers = {};
    for (const [name, raw] of Object.entries(rawServers)) {
        if (!isPlainObject(raw))
            throw new ProjectFileError(`${source} 的 mcpServers.${name} 必须是对象`);
        servers[name] = normalizeDeclaration(name, raw, source);
    }
    return { file: source, servers };
}
/**
 * 把一条声明翻译成 dsh-mcp-client 的配置。
 *
 * @param name - 原始服务器名。
 * @param declaration - 已归一化的声明。
 * @param projectRoot - 项目根目录（会话工作目录），用作 stdio 的默认 cwd。
 * @param options - 变量来源与默认值覆盖。
 * @returns 可直接传给 mcp-client 插件的配置对象。
 * @throws {ProjectFileError} 声明缺少必要字段或使用了不支持的传输。
 */
export function toClientConfig(name, declaration, projectRoot, options) {
    const expand = (value) => expandVariables(value, options.variables);
    const serverName = normalizeServerName(name);
    const timeout = declaration.toolCallTimeoutMs ?? options.toolCallTimeoutMs;
    const transport = resolveTransport(name, declaration);
    if (transport === 'stdio') {
        const command = declaration.command;
        if (command === undefined || command.trim().length === 0) {
            throw new ProjectFileError(`mcpServers.${name} 使用 stdio 传输时必须提供 command`);
        }
        return {
            transport: 'stdio',
            serverName,
            command: expand(command),
            args: (declaration.args ?? []).map(expand),
            env: expandRecord(declaration.env, expand),
            cwd: declaration.cwd === undefined
                ? projectRoot
                : isAbsolute(declaration.cwd)
                    ? declaration.cwd
                    : resolve(projectRoot, declaration.cwd),
            toolCallTimeoutMs: timeout,
            failOnStartupError: options.failOnStartupError,
        };
    }
    const url = declaration.url;
    if (url === undefined || url.trim().length === 0) {
        throw new ProjectFileError(`mcpServers.${name} 使用 HTTP 传输时必须提供 url`);
    }
    const expandedUrl = expand(url);
    assertHttpUrl(name, expandedUrl);
    return {
        transport: 'streamable-http',
        serverName,
        url: expandedUrl,
        headers: expandRecord(declaration.headers, expand),
        toolCallTimeoutMs: timeout,
        failOnStartupError: options.failOnStartupError,
    };
}
/** 根据 `type` 与声明字段推断传输方式，并拒绝不支持的传输。 */
function resolveTransport(name, declaration) {
    const type = declaration.type?.trim();
    if (type === undefined || type.length === 0) {
        if (declaration.command !== undefined)
            return 'stdio';
        if (declaration.url !== undefined)
            return 'http';
        throw new ProjectFileError(`mcpServers.${name} 必须提供 command（stdio）或 url（HTTP）`);
    }
    if (type === 'stdio')
        return 'stdio';
    if (type === 'http' || type === 'streamable-http')
        return 'http';
    if (type === 'sse') {
        throw new ProjectFileError(`mcpServers.${name} 使用 SSE 传输，dsh-mcp-client 不支持；请改用 streamable-http`);
    }
    throw new ProjectFileError(`mcpServers.${name} 的传输类型 ${JSON.stringify(type)} 不受支持`);
}
/** 校验 URL 只能是 HTTP(S)，避免把本地文件路径之类的东西传给客户端。 */
function assertHttpUrl(name, url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch (error) {
        throw new ProjectFileError(`mcpServers.${name} 的 url 不是绝对 URL: ${url}`, { cause: error });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ProjectFileError(`mcpServers.${name} 的 url 必须是 http(s) 地址: ${url}`);
    }
}
/** 展开字符串字典中的每个值；undefined 视为空字典。 */
function expandRecord(record, expand) {
    if (record === undefined)
        return {};
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, expand(value)]));
}
/** 收窄单个声明的字段类型，非字符串字段直接报错而不是静默丢弃。 */
function normalizeDeclaration(name, raw, source) {
    const error = (field, expected) => new ProjectFileError(`${source} 的 mcpServers.${name}.${field} 必须是${expected}`);
    const declaration = {};
    if (raw.type !== undefined) {
        if (typeof raw.type !== 'string')
            throw error('type', '字符串');
        declaration.type = raw.type;
    }
    if (raw.command !== undefined) {
        if (typeof raw.command !== 'string')
            throw error('command', '字符串');
        declaration.command = raw.command;
    }
    if (raw.url !== undefined) {
        if (typeof raw.url !== 'string')
            throw error('url', '字符串');
        declaration.url = raw.url;
    }
    if (raw.cwd !== undefined) {
        if (typeof raw.cwd !== 'string')
            throw error('cwd', '字符串');
        declaration.cwd = raw.cwd;
    }
    if (raw.args !== undefined) {
        if (!Array.isArray(raw.args) || raw.args.some((arg) => typeof arg !== 'string')) {
            throw error('args', '字符串数组');
        }
        declaration.args = [...raw.args];
    }
    if (raw.env !== undefined) {
        declaration.env = stringRecord(name, 'env', raw.env, source);
    }
    if (raw.headers !== undefined) {
        declaration.headers = stringRecord(name, 'headers', raw.headers, source);
    }
    if (raw.disabled !== undefined) {
        if (typeof raw.disabled !== 'boolean')
            throw error('disabled', '布尔值');
        declaration.disabled = raw.disabled;
    }
    if (raw.toolCallTimeoutMs !== undefined) {
        if (typeof raw.toolCallTimeoutMs !== 'number' ||
            !Number.isSafeInteger(raw.toolCallTimeoutMs) ||
            raw.toolCallTimeoutMs <= 0) {
            throw error('toolCallTimeoutMs', '正整数');
        }
        declaration.toolCallTimeoutMs = raw.toolCallTimeoutMs;
    }
    return declaration;
}
/** 校验并复制一个字符串字典字段。 */
function stringRecord(name, field, value, source) {
    if (!isPlainObject(value)) {
        throw new ProjectFileError(`${source} 的 mcpServers.${name}.${field} 必须是对象`);
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') {
            throw new ProjectFileError(`${source} 的 mcpServers.${name}.${field}.${key} 必须是字符串`);
        }
        result[key] = entry;
    }
    return result;
}
/** 判断一个 JSON 值是否为普通对象（排除数组与 null）。 */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
