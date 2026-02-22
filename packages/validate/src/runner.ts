import type { CommandContext } from "@crustjs/core";
import { getFlagSchema } from "./flagSpec.ts";
import type { ValidatedContext, ValidationIssue } from "./types.ts";
import { throwValidationError } from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared types for provider-agnostic validation
// ────────────────────────────────────────────────────────────────────────────

/** Minimal shape of an `arg()` spec that both providers produce. */
export interface ArgSpecLike {
	readonly name: string;
	readonly schema: unknown;
	readonly variadic: true | undefined;
}

/** Result of validating a single value against a schema. */
export type ValidationResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: ValidationIssue[] };

/**
 * Provider-specific function that validates a single value against a schema.
 *
 * May return synchronously or asynchronously — the shared runner `await`s
 * the result either way.
 */
export type ValidateValueFn = (
	schema: unknown,
	value: unknown,
	prefix: readonly PropertyKey[],
) => ValidationResult | Promise<ValidationResult>;

// ────────────────────────────────────────────────────────────────────────────
// Validation loops — shared across all providers
// ────────────────────────────────────────────────────────────────────────────

async function validateArgs(
	argSpecs: readonly ArgSpecLike[],
	context: CommandContext,
	issues: ValidationIssue[],
	validateValue: ValidateValueFn,
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
	flags: Record<string, unknown> | undefined,
	context: CommandContext,
	issues: ValidationIssue[],
	validateValue: ValidateValueFn,
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
// Run handler factory — builds the validate-then-run handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the `run` handler for a schema-validated command.
 *
 * Encapsulates the validate → collect issues → throw → build context → call
 * user handler pattern that is identical across Zod and Effect providers.
 *
 * @param argSpecs - Ordered positional arg specs from the command config
 * @param flags - Named flag schemas/specs from the command config
 * @param userRun - The user's validated handler
 * @param validateValue - Provider-specific single-value validation function
 */
export function buildRunHandler(
	argSpecs: readonly ArgSpecLike[],
	flags: Record<string, unknown> | undefined,
	userRun: (ctx: ValidatedContext<unknown, unknown>) => void | Promise<void>,
	validateValue: ValidateValueFn,
): (context: CommandContext) => Promise<void> {
	return async (context: CommandContext) => {
		const issues: ValidationIssue[] = [];
		const validatedArgs = await validateArgs(
			argSpecs,
			context,
			issues,
			validateValue,
		);
		const validatedFlags = await validateFlags(
			flags,
			context,
			issues,
			validateValue,
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

		return userRun(validatedContext);
	};
}
