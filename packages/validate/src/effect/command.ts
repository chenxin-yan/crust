import type {
	AnyCommand,
	ValidateFlagAliases,
	ValidateVariadicArgs,
} from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { either, runSync } from "effect/Effect";
import * as Either from "effect/Either";
import * as ParseResult from "effect/ParseResult";
import { decodeUnknown } from "effect/Schema";
import type { ValidationResult } from "../runner.ts";
import { buildRunHandler } from "../runner.ts";
import { normalizeIssues } from "../validation.ts";
import { argsToDefinitions, flagsToDefinitions } from "./definitions.ts";
import type {
	ArgSpec,
	EffectCommandDef,
	EffectCommandRunHandler,
	EffectSchemaLike,
	FlagShape,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Provider-specific validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a value against an Effect schema synchronously.
 *
 * Only synchronous schemas are supported. Schemas that perform async work
 * (e.g. `Schema.filterEffect`, async `Schema.transformOrFail`) will cause
 * `Effect.runSync` to throw an `AsyncFiberException` at runtime.
 */
function validateValue(
	schema: unknown,
	value: unknown,
	prefix: readonly PropertyKey[],
): ValidationResult {
	const result = runSync(
		either(decodeUnknown(schema as EffectSchemaLike)(value)),
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

// ────────────────────────────────────────────────────────────────────────────
// defineEffectCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a Crust command where Effect schemas are the source of truth.
 *
 * Only context-free (`R = never`), synchronous schemas are supported.
 * Async combinators like `Schema.filterEffect` or async `Schema.transformOrFail`
 * will throw at runtime.
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
			run: buildRunHandler(
				argSpecs,
				effectFlags as Record<string, unknown> | undefined,
				userRun as EffectCommandRunHandler<unknown, unknown>,
				validateValue,
			),
		}),
	});

	return command;
}
