/**
 * 会话创建时的项目级 MCP 挂载流程。
 *
 * 每个 agent 创建时读取其会话工作目录下的项目配置文件，把其中每台服务器作为
 * 独立的 `dsh-mcp-client` 实例挂到该 agent 的作用域上：工具随会话销毁而移除，
 * 单台服务器失败不影响其余服务器，也不影响会话创建。
 *
 * 服务器并发启动，并共享一个启动预算：任何一台连接慢或挂死都不会把首轮对话
 * 拖成 N 台服务器的最坏延迟之和。
 *
 * @module dsh-workspace-mcp/mount
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { matchesEnvPattern } from './env.js';
import { locateProjectFile, parseProjectFile, toClientConfig, } from './project-file.js';
/** 项目配置文件的大小上限：配置应当是几百字节的 JSON，而不是数据文件。 */
export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
/**
 * 单台服务器的启动预算耗尽；连接仍在后台继续，但本次不再阻塞会话创建。
 *
 * `server` 是项目文件里的原始服务器名，`timeoutMs` 是触发超时的预算（毫秒）。
 */
export class StartupTimeoutError extends Error {
    server;
    timeoutMs;
    constructor(server, timeoutMs) {
        super(`启动超过 ${timeoutMs}ms，连接仍在后台继续`);
        this.name = 'StartupTimeoutError';
        this.server = server;
        this.timeoutMs = timeoutMs;
    }
}
/** 生产环境使用的文件系统实现。 */
export const nodeMountIo = {
    exists: (path) => existsSync(path),
    readFile: (path) => {
        // stat 而不是 lstat：允许指向常规文件的软链，但拒绝 FIFO/设备/目录——
        // 对 FIFO 做同步读会永久阻塞所有会话的事件循环。
        const stats = statSync(path);
        if (!stats.isFile())
            throw new Error(`${path} 不是常规文件，已拒绝读取`);
        if (stats.size > MAX_PROJECT_FILE_BYTES) {
            throw new Error(`${path} 超过 ${MAX_PROJECT_FILE_BYTES} 字节上限（实际 ${stats.size} 字节）`);
        }
        return readFileSync(path, 'utf8');
    },
};
/**
 * 为一次 agent 创建挂载项目级 MCP 服务器。
 *
 * 所有服务器并发启动；`config.startupTimeoutMs` 是每台服务器首次连接与工具
 * 同步的预算，超时只记录失败，不阻塞会话。只有显式打开
 * `config.failOnStartupError` 时，连接/启动失败才会让本函数抛出。
 *
 * @param session - 该 agent 的会话（读取 `header.cwd` 与 `header.origin`）。
 * @param config - 插件配置。
 * @param host - 插件挂载与日志能力。
 * @param io - 文件系统访问实现，默认使用 `node:fs`。
 * @returns 命中的文件、成功的服务器与失败清单。
 * @throws 仅在 `config.failOnStartupError` 为 true 且存在启动失败时抛出。
 */
export async function mountProjectServers(session, config, host, io = nodeMountIo) {
    const result = { mounted: [], failed: [] };
    const cwd = session.header?.cwd;
    if (cwd === undefined || cwd.length === 0)
        return result;
    // 子 agent 默认不挂载：agent 作用域之间不继承项目 MCP 工具，子 agent 需要
    // 这些工具时必须显式打开 includeSubagents（代价是各自拉起一份服务器进程）。
    if (!config.includeSubagents && session.header.origin === 'subagent')
        return result;
    const depth = config.searchParents ? config.maxParentDepth : 0;
    const located = locateProjectFile(cwd, config.files, depth, io.exists);
    if (located === undefined)
        return result;
    const file = located.file;
    result.file = file;
    warnShadowedFiles(file, located.directory, config.files, io, host);
    let parsed;
    try {
        parsed = parseProjectFile(io.readFile(file), file);
    }
    catch (error) {
        // 文件本身不合法时整份跳过，但只记录告警：项目文件不应阻断会话。
        host.log('warn', `workspace-mcp: cannot load ${file}: ${describeError(error)}`);
        return result;
    }
    // 解析阶段被跳过的条目只影响它们自己，其余服务器照常挂载。
    for (const issue of parsed.issues) {
        result.failed.push({ server: issue.server, message: issue.message });
        host.log('warn', `workspace-mcp: ${file} server ${JSON.stringify(issue.server)} skipped: ${issue.message}`);
    }
    // 项目文件只作用于配置所在目录：`searchParents` 命中上级文件时，相对
    // `cwd`/`args` 也应以那份文件的目录为基准，而不是当前会话子目录。
    const projectRoot = dirname(file);
    const variables = mountVariables(config);
    const warnedEnv = new Set();
    const onMissingEnv = (envName, server) => {
        // 只对「宿主里存在、但被放行策略拦下」的变量告警；真正未定义的变量保持
        // 原有的空串语义。按变量名去重，避免每个会话刷屏。
        if (process.env[envName] === undefined || warnedEnv.has(envName))
            return;
        warnedEnv.add(envName);
        host.log('warn', `workspace-mcp: ${file} server ${JSON.stringify(server)} references env var ${envName}, `
            + 'which is set in the host process but not expanded; add it to the plugin config '
            + 'envAllowlist (e.g. ["MCP_*"]) or provide it via config env');
    };
    const entries = Object.entries(parsed.servers).filter(([, declaration]) => declaration.disabled !== true);
    const timeoutMs = config.startupTimeoutMs ?? 0;
    // 并发启动：每个 mcp-client 实例拥有独立的连接与 namespace，互不干扰。
    const outcomes = await Promise.all(entries.map(([name, declaration]) => startServer(name, declaration, {
        projectRoot,
        variables,
        config,
        host,
        timeoutMs,
        onMissingEnv,
    })));
    // 按项目文件里的声明顺序汇总，保证日志与返回值稳定。
    for (const outcome of outcomes) {
        if (outcome.ok) {
            result.mounted.push(outcome.server);
            continue;
        }
        result.failed.push({ server: outcome.server, message: outcome.message });
        host.log('warn', `workspace-mcp: ${file} server ${JSON.stringify(outcome.server)} not mounted: ${outcome.message}`);
    }
    if (result.mounted.length > 0) {
        host.log('info', `workspace-mcp: mounted ${result.mounted.length} server(s) from ${file}: ${result.mounted.join(', ')}`);
    }
    // 显式打开 failOnStartupError 时，连接/启动失败会升级为会话创建失败。
    // 配置错误（例如缺少 command）不属于连接失败，只跳过该服务器。
    if (config.failOnStartupError) {
        const fatal = [];
        for (const outcome of outcomes) {
            if (!outcome.ok && outcome.kind === 'startup') {
                fatal.push({ server: outcome.server, message: outcome.message });
            }
        }
        if (fatal.length > 0) {
            const detail = fatal.map((entry) => `${entry.server}: ${entry.message}`).join('; ');
            throw new Error(`workspace-mcp: ${fatal.length} server(s) failed to start from ${file}: ${detail}`);
        }
    }
    return result;
}
/** 启动单台服务器；配置错误与连接错误分开归类。 */
async function startServer(name, declaration, context) {
    // 审计日志记录“展开前”的声明：`${VAR}` 原样保留，不会把密钥写进日志。
    context.host.log('info', `workspace-mcp: starting ${JSON.stringify(name)}: ${describeLaunch(declaration)}`);
    let clientConfig;
    try {
        clientConfig = toClientConfig(name, declaration, context.projectRoot, {
            variables: context.variables,
            failOnStartupError: context.config.failOnStartupError,
            toolCallTimeoutMs: context.config.toolCallTimeoutMs,
            onMissingEnv: (envName) => context.onMissingEnv(envName, name),
        });
    }
    catch (error) {
        return { server: name, ok: false, kind: 'config', message: describeError(error) };
    }
    try {
        await withStartupBudget(context.host.plugin(clientConfig), context.timeoutMs, name);
        return { server: name, ok: true };
    }
    catch (error) {
        return { server: name, ok: false, kind: 'startup', message: describeError(error) };
    }
}
/**
 * 构造可展开的变量表。
 *
 * `config.env` 始终可见（用户在 profile 里显式写下的值）；进程环境只有在
 * `envAllowlist` 命中时才进入，避免仓库文件用 `${AWS_SECRET_ACCESS_KEY}`
 * 之类的占位符读走宿主凭据。
 */
function mountVariables(config) {
    const allowlist = config.envAllowlist ?? [];
    const fromProcess = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value === undefined)
            continue;
        if (allowlist.some((pattern) => matchesEnvPattern(pattern, name)))
            fromProcess[name] = value;
    }
    return { ...fromProcess, ...config.env };
}
/** 同一目录里还有其它候选配置时提醒用户谁被忽略了。 */
function warnShadowedFiles(file, directory, files, io, host) {
    for (const candidate of files) {
        const other = isAbsolute(candidate) ? candidate : resolve(directory, candidate);
        if (other === file || !io.exists(other))
            continue;
        host.log('warn', `workspace-mcp: ${other} is also present but ${file} takes precedence; remove one of them to avoid confusion`);
    }
}
/** 描述一条声明的启动方式；只使用展开前的字段，不含 env/headers 的值。 */
function describeLaunch(declaration) {
    if (declaration.url !== undefined)
        return `streamable-http ${declaration.url}`;
    const command = declaration.command ?? '(missing command)';
    const args = (declaration.args ?? []).map((arg) => JSON.stringify(arg)).join(' ');
    return `stdio ${command}${args.length > 0 ? ` ${args}` : ''}`;
}
/**
 * 给单台服务器的启动加预算。
 *
 * 超时只是让等待结束：`work` 仍会在后台继续，因此这里给它挂上 then 处理器，
 * 避免它之后失败时产生 unhandled rejection。
 *
 * @param work - 启动动作（`agent.ctx.plugin` 的结算）。
 * @param timeoutMs - 预算；`<= 0` 表示不限制。
 * @param server - 服务器名，用于超时诊断。
 */
async function withStartupBudget(work, timeoutMs, server) {
    if (timeoutMs <= 0) {
        await work;
        return;
    }
    // then 处理器同时充当错误出口：无论谁先完成，work 的失败都被消费一次。
    const tracked = work.then(() => 'ok', (error) => ({ error }));
    let timer;
    const deadline = new Promise((resolve) => {
        // 不能 unref：预算到期本身是有效的工作，unref 会让进程/测试在等待中提前收尾。
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
        const outcome = await Promise.race([tracked, deadline]);
        if (outcome === 'timeout')
            throw new StartupTimeoutError(server, timeoutMs);
        if (outcome !== 'ok')
            throw outcome.error;
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
/** 把任意错误值转成一行可读文本。 */
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
