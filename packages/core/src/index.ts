// Crust builder API
export type { CrustCommandContext } from "./crust.ts";
export { Crust, VALIDATION_MODE_ENV } from "./crust.ts";
// Errors
export type { CrustErrorCode } from "./errors.ts";
export { CrustError } from "./errors.ts";
// Internal command node type (exported for downstream packages)
export type { CommandNode } from "./node.ts";

// Argument & flag parsing
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
export type { CommandRoute } from "./router.ts";
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
	ValidateCrossCollisions,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
	ValueType,
} from "./types.ts";
