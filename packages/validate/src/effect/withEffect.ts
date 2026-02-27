import type { ArgsDef, CommandContext, FlagsDef } from "@crustjs/core";
import { standardSchemaV1 } from "effect/Schema";
import { buildValidatedRunner } from "../middleware.ts";
import type { StandardSchema } from "../standard/types.ts";
import { validateStandard } from "../standard/validate.ts";
import type { EffectSchemaLike, WithEffectHandler } from "./types.ts";
import { EFFECT_SCHEMA } from "./types.ts";

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
 * **Context-free only**: only context-free (`R = never`) schemas are
 * supported. The runtime delegates to Standard Schema's `~standard.validate`
 * which handles both sync and async validation transparently.
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
		(schema, value, prefix) =>
			validateStandard(
				standardSchemaV1(schema as EffectSchemaLike) as StandardSchema,
				value,
				prefix,
			),
		EFFECT_SCHEMA,
		"withEffect",
	) as (context: CommandContext<A, F>) => Promise<void>;
}
