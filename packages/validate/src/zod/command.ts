import type { AnyCommand, CommandContext } from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import type { ValidationIssue } from "../types.ts";
import {
	assertSyncResult,
	normalizeIssues,
	throwValidationError,
} from "../validation.ts";
import type { ValidatedContext } from "../wrapper.ts";
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

function validateValue(
	schema: ZodSchemaLike,
	value: unknown,
	prefix: readonly PropertyKey[],
):
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: ValidationIssue[] } {
	const rawResult = schema["~standard"].validate(value);
	const result = assertSyncResult(rawResult);

	if (!result.issues) {
		return { ok: true, value: result.value };
	}

	const prefixed = result.issues.map((issue) => ({
		...issue,
		path: issue.path ? [...prefix, ...issue.path] : [...prefix],
	}));

	return { ok: false, issues: normalizeIssues(prefixed) };
}

function validateArgs(
	argSpecs: readonly ArgSpec[],
	context: CommandContext,
	issues: ValidationIssue[],
): Record<string, unknown> {
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
				const validated = validateValue(spec.schema, value, [
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

		const validated = validateValue(spec.schema, input, ["args", spec.name]);
		if (!validated.ok) {
			issues.push(...validated.issues);
			continue;
		}
		output[spec.name] = validated.value;
	}

	return output;
}

function validateFlags(
	flags: FlagShape | undefined,
	context: CommandContext,
	issues: ValidationIssue[],
): Record<string, unknown> {
	if (!flags) {
		return {};
	}

	const output: Record<string, unknown> = {};

	for (const [name, rawValue] of Object.entries(flags)) {
		const schema = isFlagSpec(rawValue)
			? rawValue.schema
			: getFlagSchema(rawValue);
		const input = (context.flags as Record<string, unknown>)[name];
		const validated = validateValue(schema, input, ["flags", name]);

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
 */
export function defineZodCommand<
	const A extends readonly ArgSpec[] | undefined,
	const F extends FlagShape | undefined,
>(config: ZodCommandDef<A, F>): AnyCommand {
	const argSpecs = (config.args ?? []) as readonly ArgSpec[];
	const generatedArgs = argsToDefinitions(argSpecs);
	const generatedFlags = flagsToDefinitions(config.flags);

	const command = defineCommand({
		meta: config.meta,
		...(generatedArgs.length > 0 && { args: generatedArgs }),
		...(Object.keys(generatedFlags).length > 0 && { flags: generatedFlags }),
		...(config.subCommands && { subCommands: config.subCommands }),
		...(config.run && {
			run(context: CommandContext) {
				const issues: ValidationIssue[] = [];
				const validatedArgs = validateArgs(argSpecs, context, issues);
				const validatedFlags = validateFlags(config.flags, context, issues);

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

				return (config.run as ZodCommandRunHandler<unknown, unknown>)(
					validatedContext,
				);
			},
		}),
	});

	return command;
}
