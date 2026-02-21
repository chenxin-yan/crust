import type {
	AnyCommand,
	ArgsDef,
	Command,
	CommandContext,
	FlagsDef,
} from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { AnySchema, ValidationIssue } from "./types.ts";
import {
	assertSyncResult,
	normalizeIssues,
	throwValidationError,
} from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// Validated context — extends CommandContext with original parsed input
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extended command context passed to validated handlers.
 *
 * After validation, `args` and `flags` contain the transformed schema output.
 * The original pre-validation parsed values are preserved in `input` for
 * advanced or debug use.
 */
export interface ValidatedContext<ArgsOut, FlagsOut> {
	/** Transformed positional arguments after schema validation */
	args: ArgsOut;
	/** Transformed flags after schema validation */
	flags: FlagsOut;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
	/** The resolved command being executed */
	command: AnyCommand;
	/** Original pre-validation parsed values from the Crust parser */
	input: {
		/** Original parsed args before schema transformation */
		args: Record<string, unknown>;
		/** Original parsed flags before schema transformation */
		flags: Record<string, unknown>;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Validation schemas configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Schema configuration for the generic validation wrapper.
 *
 * Accepts Standard Schema-compatible validators for positional arguments
 * and/or flags. At least one schema must be provided.
 */
export interface ValidationSchemas<
	ArgsSchema extends AnySchema = AnySchema,
	FlagsSchema extends AnySchema = AnySchema,
> {
	/** Standard Schema-compatible validator for positional arguments */
	args?: ArgsSchema;
	/** Standard Schema-compatible validator for flags */
	flags?: FlagsSchema;
}

// ────────────────────────────────────────────────────────────────────────────
// Type inference helpers
// ────────────────────────────────────────────────────────────────────────────

/** Infer the output type of a Standard Schema, defaulting to the original parsed type */
type InferSchemaOutput<S, Fallback> =
	S extends StandardSchemaV1<infer _In, infer Out> ? Out : Fallback;

// ────────────────────────────────────────────────────────────────────────────
// Validated run handler type
// ────────────────────────────────────────────────────────────────────────────

/**
 * A command handler that receives a validated context with transformed
 * schema outputs and access to original parsed input.
 */
export type ValidatedRunHandler<ArgsOut, FlagsOut> = (
	context: ValidatedContext<ArgsOut, FlagsOut>,
) => void | Promise<void>;

// ────────────────────────────────────────────────────────────────────────────
// withValidation — generic Standard Schema wrapper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the `withValidation` wrapper.
 */
export interface WithValidationOptions<
	A extends ArgsDef,
	F extends FlagsDef,
	ArgsSchema extends AnySchema,
	FlagsSchema extends AnySchema,
> {
	/** The Crust command to wrap with validation */
	command: Command<A, F>;
	/** Standard Schema-compatible validators for args and/or flags */
	schemas: ValidationSchemas<ArgsSchema, FlagsSchema>;
	/** Validated command handler — receives transformed schema outputs */
	run: ValidatedRunHandler<
		InferSchemaOutput<ArgsSchema, CommandContext<A, F>["args"]>,
		InferSchemaOutput<FlagsSchema, CommandContext<A, F>["flags"]>
	>;
}

/**
 * Wrap an existing Crust command with Standard Schema validation.
 *
 * Accepts Standard Schema-compatible validators for `args` and/or `flags`.
 * Validation runs after Crust parsing and before the user handler executes.
 * On success, the handler receives transformed schema outputs on `context.args`
 * and `context.flags`, with original parsed values preserved on `context.input`.
 *
 * This is the generic, library-agnostic validation mode. It does not
 * auto-generate parser or help metadata from schemas.
 *
 * @param options - The command, schemas, and validated handler
 * @returns A new Crust command with validation wired in
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import { withValidation } from "@crustjs/validate";
 * import { z } from "zod";
 *
 * const base = defineCommand({
 *   meta: { name: "serve" },
 *   args: [{ name: "port", type: "number" }],
 *   flags: { verbose: { type: "boolean" } },
 * });
 *
 * const validated = withValidation({
 *   command: base,
 *   schemas: {
 *     args: z.object({ port: z.number().min(1).max(65535) }),
 *     flags: z.object({ verbose: z.boolean().default(false) }),
 *   },
 *   run({ args, flags, input }) {
 *     // args.port: number (validated, 1-65535)
 *     // flags.verbose: boolean (defaulted to false)
 *     // input.args / input.flags: original parser output
 *   },
 * });
 * ```
 */
export function withValidation<
	A extends ArgsDef,
	F extends FlagsDef,
	ArgsSchema extends AnySchema,
	FlagsSchema extends AnySchema,
>(
	options: WithValidationOptions<A, F, ArgsSchema, FlagsSchema>,
): Command<A, F> {
	const { command, schemas, run: validatedRun } = options;

	// Collect all validation issues from both schemas before throwing
	function validateAll(context: CommandContext<A, F>): {
		args: unknown;
		flags: unknown;
	} {
		const issues: ValidationIssue[] = [];
		let validatedArgs: unknown = context.args;
		let validatedFlags: unknown = context.flags;

		if (schemas.args) {
			const rawResult = schemas.args["~standard"].validate(context.args);
			const result = assertSyncResult(rawResult);
			if (result.issues) {
				const prefixed = result.issues.map((issue) => ({
					...issue,
					path: issue.path ? ["args", ...issue.path] : ["args"],
				}));
				issues.push(...normalizeIssues(prefixed));
			} else {
				validatedArgs = result.value;
			}
		}

		if (schemas.flags) {
			const rawResult = schemas.flags["~standard"].validate(context.flags);
			const result = assertSyncResult(rawResult);
			if (result.issues) {
				const prefixed = result.issues.map((issue) => ({
					...issue,
					path: issue.path ? ["flags", ...issue.path] : ["flags"],
				}));
				issues.push(...normalizeIssues(prefixed));
			} else {
				validatedFlags = result.value;
			}
		}

		if (issues.length > 0) {
			throwValidationError(issues);
		}

		return { args: validatedArgs, flags: validatedFlags };
	}

	// Build a new command with validation wired into the run handler
	const wrappedCommand: Command<A, F> = {
		...command,
		run(context: CommandContext<A, F>) {
			const originalArgs = context.args;
			const originalFlags = context.flags;
			const validated = validateAll(context);

			const validatedContext: ValidatedContext<unknown, unknown> = {
				args: validated.args,
				flags: validated.flags,
				rawArgs: context.rawArgs,
				command: context.command,
				input: {
					args: originalArgs as Record<string, unknown>,
					flags: originalFlags as Record<string, unknown>,
				},
			};

			return validatedRun(
				validatedContext as ValidatedContext<
					InferSchemaOutput<ArgsSchema, CommandContext<A, F>["args"]>,
					InferSchemaOutput<FlagsSchema, CommandContext<A, F>["flags"]>
				>,
			);
		},
	};

	return Object.freeze(wrappedCommand);
}
