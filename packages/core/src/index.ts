// v0.1 builder API
export type { ContextFactory, ContextInstance, ContextMap } from "./api/context.ts";
export { context } from "./api/context.ts";
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
export { extension } from "./api/extension.ts";

// Command snapshots
export type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./command/snapshot.ts";
// Command context
export type { CrustCommandContext } from "./command/crust.ts";
export { Crust, VALIDATION_FORCE_EXIT_ENV, VALIDATION_MODE_ENV } from "./command/crust.ts";
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
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	InheritableFlags,
	MergeFlags,
	ParseResult,
	Resolve,
	ResolveBaseType,
	ValidateCrossCollisions,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
	ValueType,
} from "./types.ts";
