// Command definition
export { defineCommand } from "./command.ts";

// Errors
export type { CommandNotFoundErrorDetails, CrustErrorCode } from "./errors.ts";
export { CrustError } from "./errors.ts";

// Argument & flag parsing
export { parseArgs } from "./parser.ts";

// Plugin runtime contracts
export type {
	CrustPlugin,
	MiddlewareContext,
	PluginMiddleware,
	SetupContext,
} from "./plugins.ts";

// Subcommand routing
export type { CommandRoute } from "./router.ts";
export { resolveCommand } from "./router.ts";

// Command execution
export type { RunOptions } from "./run.ts";
export { runCommand, runMain } from "./run.ts";

// Core types
export type {
	AnyCommand,
	ArgDef,
	ArgsDef,
	Command,
	CommandContext,
	CommandDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	ParseResult,
} from "./types.ts";
