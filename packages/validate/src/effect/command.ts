import type {
	AnyCommand,
	CommandContext,
	ValidateFlagAliases,
	ValidateVariadicArgs,
} from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as ParseResult from "effect/ParseResult";
import { decodeUnknown } from "effect/Schema";
import type { ValidatedContext, ValidationIssue } from "../types.ts";
import { normalizeIssues, throwValidationError } from "../validation.ts";
import { argsToDefinitions, flagsToDefinitions } from "./definitions.ts";
import { getFlagSchema } from "./schema.ts";
import type {
	ArgSpec,
	EffectCommandDef,
	EffectCommandRunHandler,
	EffectSchemaLike,
	FlagShape,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────────

async function validateValue(
	schema: EffectSchemaLike,
	value: unknown,
	prefix: readonly PropertyKey[],
): Promise<
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: ValidationIssue[] }
> {
	const result = await Effect.runPromise(
		Effect.either(decodeUnknown(schema)(value)),
	);

	if (Either.isRight(result)) {
		return { ok: true, value: result.right };
	}

	const flattened = ParseResult.ArrayFormatter.formatErrorSync(result.left);
	const prefixed = flattened.map(
		(issue: { message: string; path: readonly PropertyKey[] }) => ({
			message: issue.message,
			path: [...prefix, ...issue.path],
		}),
	);

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
		const schema = getFlagSchema(rawValue);
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
// defineEffectCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a Crust command where Effect schemas are the source of truth.
 */
export function defineEffectCommand<
	const A extends readonly ArgSpec[] | undefined,
	const F extends FlagShape | undefined,
>(
	config: EffectCommandDef<A, F> & {
		args?: A extends readonly object[] ? ValidateVariadicArgs<A> : A;
		flags?: F extends Record<string, unknown> ? ValidateFlagAliases<F> : F;
	},
): AnyCommand {
	const {
		args: effectArgs,
		flags: effectFlags,
		run: userRun,
		...passthrough
	} = config;

	const argSpecs = (effectArgs ?? []) as readonly ArgSpec[];
	const generatedArgs = argsToDefinitions(argSpecs);
	const generatedFlags = flagsToDefinitions(effectFlags);

	const command = defineCommand({
		...passthrough,
		...(generatedArgs.length > 0 && { args: generatedArgs }),
		...(Object.keys(generatedFlags).length > 0 && { flags: generatedFlags }),
		...(userRun && {
			async run(context: CommandContext) {
				const issues: ValidationIssue[] = [];
				const validatedArgs = await validateArgs(argSpecs, context, issues);
				const validatedFlags = await validateFlags(
					effectFlags,
					context,
					issues,
				);

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

				return (userRun as EffectCommandRunHandler<unknown, unknown>)(
					validatedContext,
				);
			},
		}),
	});

	return command;
}
