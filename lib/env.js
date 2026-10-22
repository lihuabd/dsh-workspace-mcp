/**
 * 项目文件中 `${VAR}` 占位符的展开规则。
 *
 * 支持两种写法，与 Claude Code 的 `.mcp.json` 保持一致：
 * - `${VAR}`：取变量值，未定义时展开为空字符串；
 * - `${VAR:-默认值}`：未定义时使用默认值。
 *
 * 变量是否可见由调用方决定：插件默认只把 `config.env` 和显式放行的进程变量
 * 传进来，避免仓库文件通过 `${AWS_SECRET_ACCESS_KEY}` 读取整份宿主环境。
 *
 * @module dsh-workspace-mcp/env
 */
/** 匹配 `${VAR}` 与 `${VAR:-默认值}`。 */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
/**
 * 判断变量名是否匹配一条放行模式。
 *
 * 支持三种写法：`*` 放行全部、`PREFIX_*` 前缀匹配、其余按精确名匹配。
 * 变量名按大小写敏感处理（POSIX 语义）。
 *
 * @param pattern - 配置里的放行模式。
 * @param name - 待检查的环境变量名。
 * @returns 是否放行。
 */
export function matchesEnvPattern(pattern, name) {
    if (pattern === '*')
        return true;
    if (pattern.endsWith('*'))
        return name.startsWith(pattern.slice(0, -1));
    return pattern === name;
}
/**
 * 展开字符串中的变量占位符。
 *
 * @param value - 待展开的原始字符串。
 * @param variables - 已按策略过滤后的变量来源；未定义的变量按占位符规则回退。
 * @param onMissing - 遇到未定义变量时的回调（同一占位符多次出现会多次调用，
 *   由调用方按需去重）。调用方据此区分「变量确实不存在」与「存在但被策略拦下」。
 * @returns 展开后的字符串。
 */
export function expandVariables(value, variables, onMissing) {
    return value.replace(PLACEHOLDER, (_match, name, fallback) => {
        const resolved = variables[name];
        if (resolved !== undefined)
            return resolved;
        onMissing?.(name);
        // 未定义且没有默认值时保持“空串”语义，避免把占位符原样发给服务器。
        return fallback ?? '';
    });
}
