/**
 * 项目文件中 `${VAR}` 占位符的展开规则。
 *
 * 支持两种写法，与 Claude Code 的 `.mcp.json` 保持一致：
 * - `${VAR}`：取变量值，未定义时展开为空字符串；
 * - `${VAR:-默认值}`：未定义时使用默认值。
 *
 * @module dsh-workspace-mcp/env
 */
/** 变量来源：进程环境或插件配置中的 `env`。 */
export type VariableSource = Record<string, string | undefined>;
/**
 * 展开字符串中的变量占位符。
 *
 * @param value - 待展开的原始字符串。
 * @param variables - 变量来源；未定义的变量按占位符规则回退。
 * @returns 展开后的字符串。
 */
export declare function expandVariables(value: string, variables: VariableSource): string;
