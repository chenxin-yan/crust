// Contexts and Extensions
export type {
	AnyContextFactory,
	ContextConfig,
	ContextFactory,
	ContextInstance,
	ContextMap,
	ContextRequirements,
	ContextSetup,
	Simplify,
} from "./api/context.ts";
export { defineContext } from "./api/context.ts";
export type {
	Extension,
	ExtensionConfig,
	ExtensionContext,
	ExtensionFlagDef,
	ExtensionHooks,
	Finished,
	InferExtensionFlags,
	NamedExtensionFlagDef,
	InvocationOutcome,
} from "./api/extension.ts";
export { defineExtension } from "./api/extension.ts";
export { defineArg, defineFlag } from "./api/flags.ts";
export type { UnnamedArgDef } from "./api/flags.ts";

// Command snapshots
export type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./command/snapshot.ts";
// Command definitions and context
export type {
	CommandConfig,
	CommandDefinition,
	CommandDefinitionBuilder,
	CommandRequirements,
	CrustCommandContext,
	RootCommandMeta,
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
export type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InvocationIO,
	NamedFlagDef,
	ValueType,
} from "./types.ts";
