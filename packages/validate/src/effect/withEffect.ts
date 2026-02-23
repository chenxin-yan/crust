import type { ArgsDef, CommandContext, FlagsDef } from "@crustjs/core";
import { either, runSync } from "effect/Effect";
import * as Either from "effect/Either";
import * as ParseResult from "effect/ParseResult";
import { decodeUnknown } from "effect/Schema";
import type { ValidationResult } from "../middleware.ts";
import { buildValidatedRunner } from "../middleware.ts";
import { normalizeIssues } from "../validation.ts";
import type { EffectSchemaLike, WithEffectHandler } from "./types.ts";
import { EFFECT_SCHEMA } from "./types.ts";

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
// withEffect — validated run middleware for defineCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a validated `run` handler for `defineCommand`.
 *
 * Reads Effect schemas from the command's `arg()` / `flag()` definitions,
 * validates parsed CLI input against them, and calls `handler` with
 * the transformed, fully-typed result.
 *
 * **Strict mode**: all args and flags in the command must be created with
 * `arg()` / `flag()` from `@crustjs/validate/effect`. Plain core defs cause
 * a compile-time error (handler parameter becomes `never`).
 *
 * **Sync only**: only context-free (`R = never`), synchronous schemas are
 * supported. Async combinators like `Schema.filterEffect` or async
 * `Schema.transformOrFail` will throw at runtime.
 *
 * @param handler - Receives `ValidatedContext` with typed args/flags after validation
 * @returns A `run` function compatible with `defineCommand`
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import * as Schema from "effect/Schema";
 * import { arg, flag, withEffect } from "@crustjs/validate/effect";
 *
 * const serve = defineCommand({
 *   meta: { name: "serve" },
 *   args: [arg("port", Schema.Number)],
 *   flags: { verbose: flag(Schema.Boolean, { alias: "v" }) },
 *   run: withEffect(({ args, flags }) => {
 *     // args.port: number, flags.verbose: boolean
 *   }),
 * });
 * ```
 */
export function withEffect<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(
	handler: WithEffectHandler<A, F>,
): (context: CommandContext<A, F>) => Promise<void> {
	return buildValidatedRunner(
		handler as (
			ctx: import("../types.ts").ValidatedContext<unknown, unknown>,
		) => void | Promise<void>,
		validateValue,
		EFFECT_SCHEMA,
		"withEffect",
	) as (context: CommandContext<A, F>) => Promise<void>;
}
