// Command definition
export { defineCommand } from "./command.ts";

// Errors
export type { CrustErrorCode } from "./errors.ts";
export { CrustError } from "./errors.ts";

// Argument & flag parsing
export { parseArgs } from "./parser.ts";
export type { ResolveResult } from "./router.ts";

// Subcommand routing
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
	CommandRef,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	ParsedResult,
	TypeConstructor,
} from "./types.ts";
