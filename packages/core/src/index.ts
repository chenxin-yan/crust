// Crust builder API

// Command definition
export { defineCommand } from "./command.ts";
export type { CrustCommandContext } from "./crust.ts";
export { Crust } from "./crust.ts";

// Errors
export type { CrustErrorCode } from "./errors.ts";
export { CrustError } from "./errors.ts";

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
export type { CommandRoute } from "./router.ts";
export { resolveCommand } from "./router.ts";

// Command execution
export type { RunOptions } from "./run.ts";
export { runCommand, runMain, VALIDATION_MODE_ENV } from "./run.ts";

// Core types
export type {
	AnyCommand,
	ArgDef,
	ArgsDef,
	Command,
	CommandContext,
	CommandDef,
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
