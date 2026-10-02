import type { JsonCompatible, JsonValue } from "@crustjs/utils/json";

import type { ContextValue } from "../api/context.ts";
import type { ExtensionId } from "../identity.ts";
import type { RunInputPayload } from "../parsing/parser.ts";
import type { ArgsDef, FlagsDef, InputArgs, InputFlags, InvocationOptions } from "../types.ts";
import type { IsStaticTuple } from "../validation/shared.ts";

export declare const commandProviders: unique symbol;

/** Compile-time description of one command's programmatic input and action result. */
export interface CommandShape<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Children extends object = {},
	Result = unknown,
	Providers extends Record<string, ContextValue> = Record<string, ContextValue>,
> {
	readonly [commandProviders]?: Providers;
	readonly args: A;
	readonly flags: F;
	readonly children: Children;
	readonly result: Result;
}

/** Captured invocation after lifecycle cleanup. */
export type RunOutcome<Result> = { readonly stdout: string; readonly stderr: string } & (
	| { readonly status: "completed"; readonly result: Result }
	| { readonly status: "handled"; readonly by: ExtensionId }
	| { readonly status: "failed"; readonly error: unknown }
);

/** Compile-time command tree accumulated by `.add()`. */
export type CommandTree = Record<string, CommandShape>;

/** Every valid path through a command tree, including the root path (`[]`). */
export type CommandPath<
	Tree extends object,
	Depth extends readonly unknown[] = readonly [],
	// TypeScript's instantiation limit is lower than the runtime tree limit; paths deeper than
	// 15 remain callable as strings rather than making otherwise valid large applications fail TS2589.
> = Depth["length"] extends 15
	? readonly string[]
	: string extends keyof Tree
		? readonly string[]
		:
				| readonly []
				| {
						[K in keyof Tree & string]: Tree[K] extends CommandShape
							? readonly [K, ...CommandPath<Tree[K]["children"], readonly [...Depth, unknown]>]
							: never;
				  }[keyof Tree & string];

// Editors complete path elements from this type instantiated with the partial literal being
// typed (e.g. `["remote", ""]`), so an unknown literal path must resolve to the commands under
// its longest valid prefix rather than `never` or the whole union.
type CommandPathContinuations<
	Path extends readonly string[],
	Tree extends object,
	Prefix extends readonly string[] = readonly [],
> = Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
	? readonly [...Prefix, Head] extends CommandPath<Tree>
		? CommandPathContinuations<Tail, Tree, readonly [...Prefix, Head]>
		: Extract<CommandPath<Tree>, readonly [...Prefix, ...string[]]>
	: Extract<CommandPath<Tree>, readonly [...Prefix, ...string[]]>;

export type KnownCommandPath<
	Path extends readonly string[],
	Tree extends object,
> = string extends keyof Tree
	? Path
	: IsStaticTuple<Path> extends true
		? string extends Path[number]
			? never
			: [Path] extends [CommandPath<Tree>]
				? Path
				: CommandPathContinuations<Path, Tree>
		: // An uninferred path (`at(|)`) shows every command; union paths stay rejected.
			number extends Path["length"]
			? CommandPath<Tree>
			: never;

/** Resolve the command shape at a typed path. */
export type CommandShapeAt<
	Shape extends CommandShape,
	Path extends readonly string[],
> = Path extends readonly [infer Head, ...infer Tail extends readonly string[]]
	? Head extends keyof Shape["children"]
		? Shape["children"][Head] extends infer Child extends CommandShape
			? CommandShapeAt<Child, Tail>
			: never
		: // A non-literal segment (e.g. a hand-annotated `[string, ...string[]]`
			// tuple) selects a statically unknowable command, not no command.
			string extends Head
			? CommandShape
			: never
	: Path extends readonly []
		? Shape
		: // A tail widened past the CommandPath depth cap selects a statically
			// unknowable command, so the shape (and its result) widens too.
			CommandShape;

type RunSection<Name extends string, Values> = keyof Values extends never
	? {}
	: {} extends Values
		? { [K in Name]?: Values }
		: { [K in Name]: Values };

/** Structured values bound directly against the selected command's definitions; no argv is produced. */
export type RunInput<Shape extends CommandShape> = RunSection<
	"args",
	ArgsDef extends Shape["args"] ? NonNullable<RunInputPayload["args"]> : InputArgs<Shape["args"]>
> &
	RunSection<
		"flags",
		FlagsDef extends Shape["flags"]
			? // `{}` also passes the open-set check; a command with no flags stays closed.
				[keyof Shape["flags"]] extends [never]
				? {}
				: NonNullable<RunInputPayload["flags"]>
			: InputFlags<Shape["flags"]>
	> & {
		readonly raw?: readonly string[];
	};

// Check each prefix separately so JSON compatibility cannot recombine positional branches.
type CompatibleRunValue<Expected, Actual> = Actual extends Expected
	? Actual extends object
		? Expected extends unknown
			? Actual extends Expected
				? Actual & { [K in Exclude<keyof Actual, keyof Expected>]: never } & {
						[K in keyof Actual & keyof Expected]: CompatibleRunValue<Expected[K], Actual[K]>;
					}
				: never
			: never
		: Actual
	: JsonValue extends Expected
		? Actual extends JsonCompatible<Actual>
			? Actual
			: never
		: Expected extends unknown
			? CompatibleRunBranch<Expected, Actual>
			: never;

type CompatibleRunBranch<Expected, Actual> = Actual extends Expected
	? Actual
	: Expected extends readonly (infer Item)[]
		? JsonValue extends Item
			? Actual extends (
					Expected extends readonly [unknown, ...unknown[]]
						? readonly [unknown, ...unknown[]]
						: readonly unknown[]
				)
				? Actual extends JsonCompatible<Actual>
					? Actual
					: never
				: never
			: never
		: Actual extends object
			? string extends keyof Expected
				? {
						[K in keyof Actual]: CompatibleRunValue<
							Exclude<Expected[K & keyof Expected], undefined>,
							Actual[K]
						>;
					}
				: {
						[K in keyof Expected]: K extends keyof Actual
							? CompatibleRunValue<Exclude<Expected[K], undefined>, Actual[K]>
							: Expected[K];
					} & { [K in Exclude<keyof Actual, keyof Expected>]: never }
			: never;

export type CompatibleRunInput<Shape extends CommandShape, Input> = CompatibleRunValue<
	RunInput<Shape>,
	Input
>;

export type RunInputArguments<Shape extends CommandShape> =
	{} extends RunInput<Shape>
		? readonly [input?: RunInput<Shape>]
		: readonly [input: RunInput<Shape>];

export type RunArguments<Shape extends CommandShape> = readonly [
	...RunInputArguments<Shape>,
	options?: InvocationOptions,
];

type KeysOf<T> = T extends unknown ? keyof T : never;

// Undeclared literal keys may only hold `undefined`, which the runtime treats as omitted. Other
// values map to `never` rather than `undefined`: a unit-typed conflict would collapse the whole
// intersection and hide which key is wrong. Non-literal keys (index signatures) cannot be named
// statically and are left to value checks.
type UnknownRunKeys<Actual, Known> = {
	[
		K in keyof Actual as string extends K
			? never
			: number extends K
				? never
				: K extends Known
					? never
					: K
	]: Actual[K] extends undefined ? Actual[K] : never;
};

// Excess-property checks only reach fresh object literals. Closing the keys of the inferred
// input, per union member, also rejects unknown keys in inputs held in variables.
type ClosedRunInput<Shape extends CommandShape, Input> = Input extends unknown
	? UnknownRunKeys<Input, keyof RunInput<Shape>> & {
			[
				K in keyof Input as K extends ("args" | "flags") & keyof RunInput<Shape> ? K : never
			]: UnknownRunKeys<
				NonNullable<Input[K]>,
				KeysOf<NonNullable<RunInput<Shape>[K & keyof RunInput<Shape>]>>
			>;
		}
	: never;

// TypeScript infers a union-typed input as only its first member. Checking
// a passing input against the whole `RunInput` avoids false errors on the other members.
// Spelled through `RunInputArguments`: a bare `RunInput<Shape>` here makes checking `Crust`
// instances exceed TypeScript's union size limit (TS2590).
// ponytail: a variable typed as a union is closed on its first member only; closing every member
// needs inference to keep the whole union.
export type CheckedRunInput<Shape extends CommandShape, Input> = [Input] extends [
	ClosedRunInput<Shape, Input>,
]
	? NonNullable<RunInputArguments<Shape>[0]>
	: Input & NoInfer<ClosedRunInput<Shape, Input>>;

// `undefined` input stands for omitted input, so only a command that requires nothing accepts it.
export type OmittableRunInput<Shape extends CommandShape> =
	{} extends RunInput<Shape> ? undefined : never;

// A path-only call has no input to infer from, so requiredness is checked on the command itself.
// An unknown path selects no command (`never`); leave that error to the path parameter.
export type RunWithoutInputThis<Shape extends CommandShape, This> = [Shape] extends [never]
	? This
	: {} extends RunInput<Shape>
		? This
		: This & { readonly FIX_MISSING_INPUT: "Pass the command's required arguments or flags" };

/**
 * Typed invoker bound to one command in an app, returned by {@link Crust.at}.
 *
 * `run` accepts the same structured input and options as `Crust.run` with the
 * path already applied, so a handle can be re-exported as a plain typed function.
 */
export interface CommandHandle<Shape extends CommandShape> {
	/** The typed path this handle was created with (`[]` selects the root). */
	readonly path: readonly string[];
	run(this: RunWithoutInputThis<Shape, unknown>): Promise<RunOutcome<Shape["result"]>>;
	run<const Input extends RunInput<Shape> | OmittableRunInput<Shape> = RunInput<Shape>>(
		input: CheckedRunInput<Shape, Input> | OmittableRunInput<Shape>,
		options?: InvocationOptions,
	): Promise<RunOutcome<Shape["result"]>>;
	run<const Input>(
		input: Input,
		...validation: [Input] extends [CompatibleRunInput<Shape, Input>]
			? readonly [options?: InvocationOptions]
			: readonly [invalidInput: never]
	): Promise<RunOutcome<Shape["result"]>>;
}
