// command
export { defineCommand } from "./command.ts";
export type { CrustErrorCode } from "./errors.ts";

// errors
export { CrustError } from "./errors.ts";
// parser
export { parseArgs } from "./parser.ts";

// types
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
	ParsedResult,
	TypeConstructor,
} from "./types.ts";
