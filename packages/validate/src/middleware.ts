// ────────────────────────────────────────────────────────────────────────────
// Validated run middleware — reads `[VALIDATED_SCHEMA]` brand off command defs
// ────────────────────────────────────────────────────────────────────────────

import type { CrustCommandContext } from "@crustjs/core";
import { VALIDATED_SCHEMA } from "./schema-types.ts";
import type {
	StandardSchema,
	ValidatedContext,
	ValidationIssue,
	ValidationResult,
} from "./types.ts";
import { validateStandard } from "./validate.ts";
import { throwValidationError } from "./validation.ts";

// Re-export the result type so callers that previously imported it from
// `middleware.ts` continue to work.
export type { ValidationResult } from "./types.ts";

/**
 * Per-value validator. The Standard Schema spec allows
 * `~standard.validate` to return either a synchronous result or a
 * `Promise`; both are handled here.
 */
export type ValidateValueFn = (
	schema: StandardSchema,
	value: unknown,
	prefix: readonly PropertyKey[],
) => ValidationResult | Promise<ValidationResult>;

// ────────────────────────────────────────────────────────────────────────────
// buildValidatedRunner
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a validated `run` handler that reads the Standard Schema attached
 * to each command def via the `[VALIDATED_SCHEMA]` brand and runs it
 * against the parsed CLI input.
 *
 * Behaviour:
 *
 * 1. Iterates `context.command.args` and `context.command.effectiveFlags`.
 * 2. For each def carrying `[VALIDATED_SCHEMA]`, validates the parsed value
 *    against the schema (await-safe so async refinements work).
 * 3. Defs without the brand pass through unchanged — this allows plugins
 *    (e.g. `helpPlugin` injecting `--help`) to coexist with validated args.
 * 4. Collects issues across all schemas, then either throws
 *    `CrustError("VALIDATION")` with a bullet-list message or calls
 *    `userRun` with a `ValidatedContext` containing the transformed values.
 *
 * @param userRun - The user's validated handler.
 * @param validateValue - Validator override. Defaults to `validateStandard`,
 *   which awaits sync/async results from `schema["~standard"].validate`.
 *   The override exists so deprecated alias barrels can pre-process schemas
 *   without re-implementing the runner.
 * @param label - Prefix for error messages (e.g. `"commandValidator"`).
 */
export function buildValidatedRunner(
	userRun: (ctx: ValidatedContext<unknown, unknown>) => void | Promise<void>,
	validateValue: ValidateValueFn = validateStandard,
	label = "commandValidator",
): (context: CrustCommandContext) => Promise<void> {
	return async (context: CrustCommandContext) => {
		const issues: ValidationIssue[] = [];

		// ── Validate args ─────────────────────────────────────────────────
		const argDefs = context.command.args ?? [];
		const validatedArgs: Record<string, unknown> = {};

		for (const def of argDefs) {
			const schema = (def as unknown as Record<symbol, unknown>)[
				VALIDATED_SCHEMA
			] as StandardSchema | undefined;
			if (!schema) {
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
		const flagDefs = context.command.effectiveFlags ?? {};
		const validatedFlags: Record<string, unknown> = {};

		for (const [name, def] of Object.entries(flagDefs)) {
			const schema = (def as unknown as Record<symbol, unknown>)[
				VALIDATED_SCHEMA
			] as StandardSchema | undefined;
			if (!schema) {
				// Skip flags without schema metadata — they may be injected by
				// plugins (e.g. helpPlugin's `--help`). Compile-time
				// `HasAllSchemas` catches user mistakes; runtime is permissive.
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
