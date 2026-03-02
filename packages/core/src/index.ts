// Crust builder API
export type { CrustCommandContext } from "./crust.ts";
export { Crust, VALIDATION_MODE_ENV } from "./crust.ts";
// Errors
export type { CrustErrorCode } from "./errors.ts";
export { CrustError } from "./errors.ts";
// Internal command node (exported for downstream packages)
export type { CommandNode } from "./node.ts";
export { computeEffectiveFlags, createCommandNode } from "./node.ts";

// Argument & flag parsing
export type { ParseableCommand } from "./parser.ts";
export { parseArgs } from "./parser.ts";

// Plugin runtime contracts
export type {
	CrustPlugin,
	MiddlewareContext,
	PluginMiddleware,
	SetupActions,
	SetupContext,
} from "./plugins.ts";

// Subcommand routing
export type { CommandRoute, RoutableCommand } from "./router.ts";
export { resolveCommand } from "./router.ts";

// Core types
export type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	InheritableFlags,
	MergeFlags,
	ParseResult,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
	ValueType,
} from "./types.ts";
