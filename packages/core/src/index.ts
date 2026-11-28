// Contexts and Extensions
export type {
	AnyContextFactory,
	AnyContextInstance,
	ContextBag,
	ContextBuilder,
	ContextFactory,
	ContextInstance,
	ContextMap,
	ContextSetup,
	FactoryValueOf,
} from "./api/context.ts";
export { contextSources, defineContext } from "./api/context.ts";
export type {
	BuildArtifacts,
	BuildFile,
	BuildReport,
	Extension,
	ExtensionBuilder,
	ExtensionFactory,
	RootMetaKey,
	ExtensionBuildContext,
	ExtensionContext,
	ExtensionFlagDef,
	ExtensionFlagsDef,
	ExtensionHandleOptions,
	ExtensionSectionContribution,
	ExtensionSetupContext,
	ExtensionHooks,
	InferExtensionFlags,
	InvocationOutcome,
	ParsedCommandArgv,
	Renderer,
	UsedContexts,
	UseSource,
} from "./api/extension.ts";
export { defineExtension } from "./api/extension.ts";
export { defineArg, defineFlag } from "./api/flags.ts";
export type { UnnamedArgDef } from "./api/flags.ts";

// Command snapshots
export type {
	ArgSnapshot,
	CommandGroup,
	CommandSnapshot,
	FlagSnapshot,
} from "./command/snapshot.ts";
// Command definitions and context
export type {
	AnyCrust,
	CommandConfig,
	CommandDefinition,
	CommandDefinitionBuilder,
	CommandGroupBuilder,
	CrustCommandContext,
	FlagGroupBuilder,
	GroupBuilder,
	RootCommandMeta,
} from "./command/crust.ts";
export { Crust, defineCommand } from "./command/crust.ts";
export { unknownCommand } from "./command/router.ts";
// Typed programmatic invocation
export type {
	CommandHandle,
	CommandPath,
	CommandShape,
	CommandShapeAt,
	CommandTree,
	RunArguments,
	RunInput,
	RunInputArguments,
	RunOutcome,
	ShapeRunOutcome,
} from "./command/typed-run.ts";
// Errors
export type {
	CommandNotFoundErrorDetails,
	CrustErrorCode,
	CrustErrorDetails,
	CrustErrorJson,
	CrustErrorDetailsMap,
	DefinitionErrorDetails,
	DefinitionErrorReason,
	EnvErrorDetails,
	EnvIssue,
	OutputErrorDetails,
	ParseErrorDetails,
	ParseErrorReason,
	ValidationErrorDetails,
} from "./errors.ts";
export { CrustError } from "./errors.ts";
// Runtime artifact resolution
export { artifactPath } from "@crustjs/utils/artifacts";
// Core types
export type {
	ArgDef,
	ArgExtras,
	ArgsDef,
	CommandExtras,
	CommandMeta,
	CommandSection,
	CommandSectionInput,
	SectionAudience,
	SectionConsumer,
	FlagDef,
	FlagExtras,
	FlagsDef,
	InferArgs,
	InferFlags,
	InputArgs,
	InputFlags,
	ExecuteOptions,
	InputStream,
	InvocationIO,
	InvocationOptions,
	OutputSink,
	OutputStream,
	MergeContext,
	MergeFlags,
	ParsedArgValue,
	ParsedFlagValue,
	ParseResult,
	ValidatedInput,
	ValueSource,
	ValueType,
	VariadicMode,
} from "./types.ts";
