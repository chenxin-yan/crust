import type { CommandContext } from "@crustjs/core";
import type { ValidatedContext, ValidationIssue } from "./types.ts";
import { throwValidationError } from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared types for provider-agnostic validation
// ────────────────────────────────────────────────────────────────────────────

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
// Shared validation middleware — reads schemas from command defs via symbol
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a validated `run` handler that reads schema metadata from the
 * command's own `args` / `flags` definitions via a provider-specific symbol key.
 *
 * At runtime:
 * 1. Reads `context.command.args` and `context.command.flags`
 * 2. Extracts schemas from each def via `def[schemaKey]`
 * 3. Validates `context.args[name]` / `context.flags[name]` against schemas
 * 4. Collects issues → throws `CrustError("VALIDATION")` if any
 * 5. Calls user handler with `ValidatedContext`
 *
 * @param userRun - The user's validated handler
 * @param validateValue - Provider-specific single-value validation function
 * @param schemaKey - The symbol key used to attach schemas to defs
 * @param label - Label for error messages (e.g. `"withZod"`)
 */
export function buildValidatedRunner(
	userRun: (ctx: ValidatedContext<unknown, unknown>) => void | Promise<void>,
	validateValue: ValidateValueFn,
	schemaKey: symbol,
	label: string,
): (context: CommandContext) => Promise<void> {
	return async (context: CommandContext) => {
		const issues: ValidationIssue[] = [];

		// ── Validate args ─────────────────────────────────────────────────
		const argDefs = context.command.args ?? [];
		const validatedArgs: Record<string, unknown> = {};

		for (const def of argDefs) {
			const schema = (def as Record<symbol, unknown>)[schemaKey];
			if (!schema) {
				// Skip args without schema metadata — they may be injected by
				// plugins. Compile-time `HasAllSchemas` catches user mistakes;
				// at runtime we silently pass through non-schema defs.
				validatedArgs[def.name] = (context.args as Record<string, unknown>)[
					def.name
				];
				continue;
			}

			const rawValue = (context.args as Record<string, unknown>)[def.name];

			if (def.variadic) {
				const items = Array.isArray(rawValue)
					? rawValue
					: rawValue === undefined
						? []
						: [rawValue];

				const transformed: unknown[] = [];
				for (let i = 0; i < items.length; i++) {
					const value = items[i];
					const result = await validateValue(schema, value, [
						"args",
						def.name,
						i,
					]);
					if (!result.ok) {
						issues.push(...result.issues);
						continue;
					}
					transformed.push(result.value);
				}

				validatedArgs[def.name] = transformed;
				continue;
			}

			const result = await validateValue(schema, rawValue, ["args", def.name]);
			if (!result.ok) {
				issues.push(...result.issues);
				continue;
			}
			validatedArgs[def.name] = result.value;
		}

		// ── Validate flags ────────────────────────────────────────────────
		const flagDefs = context.command.flags ?? {};
		const validatedFlags: Record<string, unknown> = {};

		for (const [name, def] of Object.entries(flagDefs)) {
			const schema = (def as Record<symbol, unknown>)[schemaKey];
			if (!schema) {
				// Skip flags without schema metadata — they may be injected by
				// plugins (e.g. helpPlugin injects --help). Compile-time
				// `HasAllSchemas` catches user mistakes; at runtime we silently
				// pass through non-schema defs.
				validatedFlags[name] = (context.flags as Record<string, unknown>)[name];
				continue;
			}

			const rawValue = (context.flags as Record<string, unknown>)[name];
			const result = await validateValue(schema, rawValue, ["flags", name]);

			if (!result.ok) {
				issues.push(...result.issues);
				continue;
			}
			validatedFlags[name] = result.value;
		}

		// ── Throw or call handler ─────────────────────────────────────────
		if (issues.length > 0) {
			throwValidationError(issues, `${label}: validation failed`);
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
