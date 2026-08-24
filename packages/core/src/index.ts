// Contexts and Extensions
export type {
	AnyContextFactory,
	ContextBag,
	ContextConfig,
	ContextFactory,
	ContextInstance,
	ContextMap,
	ContextSetup,
	FactoryValueOf,
} from "./api/context.ts";
export { defineContext } from "./api/context.ts";
export type {
	Extension,
	ExtensionBuildContext,
	ExtensionConfig,
	ExtensionContext,
	ExtensionFlagDef,
	ExtensionSectionContribution,
	ExtensionHooks,
	Finished,
	InferExtensionFlags,
	InvocationOutcome,
	NamedExtensionFlagDef,
} from "./api/extension.ts";
export { defineExtension } from "./api/extension.ts";
export type { ExtensionId } from "./identity.ts";
export { defineExtensionId } from "./identity.ts";
export { defineArg, defineFlag } from "./api/flags.ts";
export type { UnnamedArgDef } from "./api/flags.ts";

// Command snapshots
export type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./command/snapshot.ts";
// Command definitions and context
export type {
	AnyCrust,
	CommandConfig,
	CommandDefinition,
	CommandDefinitionBuilder,
	CommandPath,
	CommandShape,
	CommandShapeAt,
	CommandTree,
	CrustCommandContext,
	RootCommandMeta,
	RunArguments,
	RunInput,
	RunInputArguments,
	RunOutcome,
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
	CommandSection,
	CommandSectionInput,
	SectionAudience,
	SectionConsumer,
	FlagDef,
	FlagsDef,
	InputArgs,
	InputFlags,
	InvocationIO,
	NamedFlagDef,
	ParsedArgValue,
	ParsedFlagValue,
	ParseResult,
	ValidatedInput,
	ValueType,
} from "./types.ts";
