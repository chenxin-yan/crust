import type {
	AnyCommand,
	CommandContext,
	ValidateFlagAliases,
	ValidateVariadicArgs,
} from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { safeParseAsync } from "zod/v4/core";
import type { ValidatedContext, ValidationIssue } from "../types.ts";
import { normalizeIssues, throwValidationError } from "../validation.ts";
import { argsToDefinitions, flagsToDefinitions } from "./definitions.ts";
import { getFlagSchema, isFlagSpec } from "./schema.ts";
import type {
	ArgSpec,
	FlagShape,
	ZodCommandDef,
	ZodCommandRunHandler,
	ZodSchemaLike,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────────

async function validateValue(
	schema: ZodSchemaLike,
	value: unknown,
	prefix: readonly PropertyKey[],
): Promise<
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: ValidationIssue[] }
> {
	const parseResult = await safeParseAsync(schema, value);

	if (parseResult.success) {
		return { ok: true, value: parseResult.data };
	}

	const prefixed = parseResult.error.issues.map((issue) => ({
		message: issue.message,
		path: [...prefix, ...(issue.path ?? [])],
	}));

	return { ok: false, issues: normalizeIssues(prefixed) };
}

async function validateArgs(
	argSpecs: readonly ArgSpec[],
	context: CommandContext,
	issues: ValidationIssue[],
): Promise<Record<string, unknown>> {
	const output: Record<string, unknown> = {};

	for (const spec of argSpecs) {
		const input = (context.args as Record<string, unknown>)[spec.name];

		if (spec.variadic) {
			const items = Array.isArray(input)
				? input
				: input === undefined
					? []
					: [input];

			const transformed: unknown[] = [];
			for (let i = 0; i < items.length; i++) {
				const value = items[i];
				const validated = await validateValue(spec.schema, value, [
					"args",
					spec.name,
					i,
				]);
				if (!validated.ok) {
					issues.push(...validated.issues);
					continue;
				}
				transformed.push(validated.value);
			}

			output[spec.name] = transformed;
			continue;
		}

		const validated = await validateValue(spec.schema, input, [
			"args",
			spec.name,
		]);
		if (!validated.ok) {
			issues.push(...validated.issues);
			continue;
		}
		output[spec.name] = validated.value;
	}

	return output;
}

async function validateFlags(
	flags: FlagShape | undefined,
	context: CommandContext,
	issues: ValidationIssue[],
): Promise<Record<string, unknown>> {
	if (!flags) {
		return {};
	}

	const output: Record<string, unknown> = {};

	for (const [name, rawValue] of Object.entries(flags)) {
		const schema = isFlagSpec(rawValue)
			? rawValue.schema
			: getFlagSchema(rawValue);
		const input = (context.flags as Record<string, unknown>)[name];
		const validated = await validateValue(schema, input, ["flags", name]);

		if (!validated.ok) {
			issues.push(...validated.issues);
			continue;
		}

		output[name] = validated.value;
	}

	return output;
}

// ────────────────────────────────────────────────────────────────────────────
// defineZodCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a Crust command where schemas are the source of truth.
 *
 * Positional args are declared with `arg(name, schema)` in an ordered array,
 * flags are declared as plain schemas or `flag(schema, meta)` wrappers.
 *
 * The factory generates Crust parser/help definitions and runs schema
 * validation after parsing but before user handler execution.
 *
 * Compile-time validation (via intersection branding) catches:
 * - Variadic args that aren't in the last position
 * - Flag alias collisions (alias→name or alias→alias)
 */
export function defineZodCommand<
	const A extends readonly ArgSpec[] | undefined,
	const F extends FlagShape | undefined,
>(
	config: ZodCommandDef<A, F> & {
		args?: A extends readonly object[] ? ValidateVariadicArgs<A> : A;
		flags?: F extends Record<string, unknown> ? ValidateFlagAliases<F> : F;
	},
): AnyCommand {
	// Destructure Zod-specific fields; rest-spread forwards passthrough fields
	// (meta, subCommands, preRun, postRun, + any future CommandDef additions)
	// to defineCommand automatically.
	const {
		args: zodArgs,
		flags: zodFlags,
		run: userRun,
		...passthrough
	} = config;

	const argSpecs = (zodArgs ?? []) as readonly ArgSpec[];
	const generatedArgs = argsToDefinitions(argSpecs);
	const generatedFlags = flagsToDefinitions(zodFlags);

	const command = defineCommand({
		...passthrough,
		...(generatedArgs.length > 0 && { args: generatedArgs }),
		...(Object.keys(generatedFlags).length > 0 && { flags: generatedFlags }),
		...(userRun && {
			async run(context: CommandContext) {
				const issues: ValidationIssue[] = [];
				const validatedArgs = await validateArgs(argSpecs, context, issues);
				const validatedFlags = await validateFlags(zodFlags, context, issues);

				if (issues.length > 0) {
					throwValidationError(issues);
				}

				const validatedContext: ValidatedContext<unknown, unknown> = {
					args: validatedArgs,
					flags: validatedFlags,
					rawArgs: context.rawArgs,
					command: context.command,
					input: {
						args: context.args as Record<string, unknown>,
						flags: context.flags as Record<string, unknown>,
					},
				};

				return (userRun as ZodCommandRunHandler<unknown, unknown>)(
					validatedContext,
				);
			},
		}),
	});

	return command;
}
