// v0.1 builder API
export type { ContextFactory, ContextInstance, ContextMap } from "./api/context.ts";
export { defineContext } from "./api/context.ts";
export type {
	Extension,
	ExtensionCommand,
	ExtensionConfig,
	ExtensionContext,
	ExtensionErrorHandler,
	ExtensionFlagDef,
	ExtensionIntercept,
	ExtensionNext,
} from "./api/extension.ts";
export { defineExtension } from "./api/extension.ts";
export { defineFlag, defineFlags } from "./api/flags.ts";
export type { DefineFlag, DefineFlags } from "./api/flags.ts";

// Command snapshots
export type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./command/snapshot.ts";
// Command definitions and context
export type {
	CommandDefinition,
	CommandDefinitionBuilder,
	CommandDefinitionFactory,
	CommandRequirements,
	CrustCommandContext,
} from "./command/crust.ts";
export { Crust, defineCommand } from "./command/crust.ts";
// Errors
export type {
	CommandNotFoundErrorDetails,
	CrustErrorCode,
	CrustErrorDetails,
	CrustErrorDetailsMap,
	DefinitionErrorDetails,
	ParseErrorDetails,
	ValidationErrorDetails,
} from "./errors.ts";
export { CrustError } from "./errors.ts";
// Core types
export type { ArgDef, ArgsDef, CommandMeta, FlagDef, FlagsDef, ValueType } from "./types.ts";
