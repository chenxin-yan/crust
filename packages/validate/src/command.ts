// ────────────────────────────────────────────────────────────────────────────
// commandValidator() — Standard Schema-driven validated run middleware
// ────────────────────────────────────────────────────────────────────────────

import type { ArgsDef, CrustCommandContext, FlagsDef } from "@crustjs/core";
import { buildValidatedRunner } from "./middleware.ts";
import type { CommandValidatorHandler } from "./schema-types.ts";
import type { ValidatedContext } from "./types.ts";

/**
 * Create a validated `run` handler for the Crust builder.
 *
 * Reads the Standard Schema attached to each `arg()`/`flag()` definition,
 * validates parsed CLI input against the schemas, and forwards a fully
 * typed `ValidatedContext` to `handler`.
 *
 * **Strict mode**: every arg and flag in the command must be created with
 * `arg()` / `flag()` from `@crustjs/validate`. Plain core defs cause a
 * compile-time error (handler parameter resolves to `never`).
 *
 * Validation outcomes:
 * - All schemas succeed → `handler` receives the transformed values.
 * - Any schema fails → throws `CrustError("VALIDATION")` with a bullet-list
 *   message and the normalized issues attached as `error.details.issues`.
 * - Plugin-injected flags (e.g. `--help`) without schemas are silently
 *   passed through to the handler unchanged.
 *
 * The Standard Schema spec allows `~standard.validate` to return either a
 * synchronous result or a `Promise`. Both are handled transparently.
 *
 * @param handler - Receives `ValidatedContext` with typed args/flags
 * @returns A `run` function compatible with `Crust.run()`
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { z } from "zod";
 * import { arg, flag, commandValidator } from "@crustjs/validate";
 *
 * const serve = new Crust("serve")
 *   .args([arg("port", z.number().int().min(1))])
 *   .flags({ verbose: flag(z.boolean().default(false), { short: "v" }) })
 *   .run(commandValidator(({ args, flags }) => {
 *     // args.port: number, flags.verbose: boolean
 *   }));
 * ```
 */
export function commandValidator<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(
	handler: CommandValidatorHandler<A, F>,
): (context: CrustCommandContext<A, F>) => Promise<void> {
	return buildValidatedRunner(
		handler as (
			ctx: ValidatedContext<unknown, unknown>,
		) => void | Promise<void>,
	) as (context: CrustCommandContext<A, F>) => Promise<void>;
}
