import type { ArgsDef, CommandContext, FlagsDef } from "@crustjs/core";
import { buildValidatedRunner } from "../middleware.ts";
import type { StandardSchema } from "../standard/types.ts";
import { validateStandard } from "../standard/validate.ts";
import type { CommandValidatorHandler } from "./types.ts";
import { ZOD_SCHEMA } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// commandValidator — validated run middleware for defineCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a validated `run` handler for `defineCommand`.
 *
 * Reads Zod schemas from the command's `arg()` / `flag()` definitions,
 * validates parsed CLI input against them, and calls `handler` with
 * the transformed, fully-typed result.
 *
 * **Strict mode**: all args and flags in the command must be created with
 * `arg()` / `flag()` from `@crustjs/validate/zod`. Plain core defs cause
 * a compile-time error (handler parameter becomes `never`).
 *
 * @param handler - Receives `ValidatedContext` with typed args/flags after validation
 * @returns A `run` function compatible with `defineCommand`
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import { z } from "zod";
 * import { arg, flag, commandValidator } from "@crustjs/validate/zod";
 *
 * const serve = defineCommand({
 *   meta: { name: "serve" },
 *   args: [arg("port", z.number().min(1))],
 *   flags: { verbose: flag(z.boolean().default(false), { alias: "v" }) },
 *   run: commandValidator(({ args, flags }) => {
 *     // args.port: number, flags.verbose: boolean
 *   }),
 * });
 * ```
 */
export function commandValidator<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(
	handler: CommandValidatorHandler<A, F>,
): (context: CommandContext<A, F>) => Promise<void> {
	return buildValidatedRunner(
		handler as (
			ctx: import("../types.ts").ValidatedContext<unknown, unknown>,
		) => void | Promise<void>,
		(schema, value, prefix) =>
			validateStandard(schema as StandardSchema, value, prefix),
		ZOD_SCHEMA,
		"commandValidator",
	) as (context: CommandContext<A, F>) => Promise<void>;
}
