import type { ArgsDef, CommandContext, FlagsDef } from "@crustjs/core";
import { safeParseAsync } from "zod/v4/core";
import type { ValidationResult } from "../middleware.ts";
import { buildValidatedRunner } from "../middleware.ts";
import { normalizeIssues } from "../validation.ts";
import type { WithZodHandler, ZodSchemaLike } from "./types.ts";
import { ZOD_SCHEMA } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Provider-specific validation
// ────────────────────────────────────────────────────────────────────────────

async function validateValue(
	schema: unknown,
	value: unknown,
	prefix: readonly PropertyKey[],
): Promise<ValidationResult> {
	const parseResult = await safeParseAsync(schema as ZodSchemaLike, value);

	if (parseResult.success) {
		return { ok: true, value: parseResult.data };
	}

	const prefixed = parseResult.error.issues.map((issue) => ({
		message: issue.message,
		path: [...prefix, ...(issue.path ?? [])],
	}));

	return { ok: false, issues: normalizeIssues(prefixed) };
}

// ────────────────────────────────────────────────────────────────────────────
// withZod — validated run middleware for defineCommand
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
 * import { arg, flag, withZod } from "@crustjs/validate/zod";
 *
 * const serve = defineCommand({
 *   meta: { name: "serve" },
 *   args: [arg("port", z.number().min(1))],
 *   flags: { verbose: flag(z.boolean().default(false), { alias: "v" }) },
 *   run: withZod(({ args, flags }) => {
 *     // args.port: number, flags.verbose: boolean
 *   }),
 * });
 * ```
 */
export function withZod<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(
	handler: WithZodHandler<A, F>,
): (context: CommandContext<A, F>) => Promise<void> {
	return buildValidatedRunner(
		handler as (
			ctx: import("../types.ts").ValidatedContext<unknown, unknown>,
		) => void | Promise<void>,
		validateValue,
		ZOD_SCHEMA,
		"withZod",
	) as (context: CommandContext<A, F>) => Promise<void>;
}
