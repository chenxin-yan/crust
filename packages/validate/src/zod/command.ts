import type {
	AnyCommand,
	ValidateFlagAliases,
	ValidateVariadicArgs,
} from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { safeParseAsync } from "zod/v4/core";
import type { ValidationResult } from "../runner.ts";
import { buildRunHandler } from "../runner.ts";
import { normalizeIssues } from "../validation.ts";
import { argsToDefinitions, flagsToDefinitions } from "./definitions.ts";
import type {
	ArgSpec,
	FlagShape,
	ZodCommandDef,
	ZodCommandRunHandler,
	ZodSchemaLike,
} from "./types.ts";

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
// defineZodCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Define a Crust command where schemas are the source of truth.
 *
 * Positional args are declared with `arg(name, schema)` in an ordered array,
 * flags are declared as plain schemas or `flag(schema, meta)` wrappers.
 *
 * The factory generates Crust parser/help definitions and runs schema
 * validation after parsing but before user handler execution.
 *
 * Compile-time validation (via intersection branding) catches:
 * - Variadic args that aren't in the last position
 * - Flag alias collisions (alias→name or alias→alias)
 */
export function defineZodCommand<
	const A extends readonly ArgSpec[] | undefined,
	const F extends FlagShape | undefined,
>(
	config: ZodCommandDef<A, F> & {
		args?: A extends readonly object[] ? ValidateVariadicArgs<A> : A;
		flags?: F extends Record<string, unknown> ? ValidateFlagAliases<F> : F;
	},
): AnyCommand {
	// Destructure Zod-specific fields; rest-spread forwards passthrough fields
	// (meta, subCommands, preRun, postRun, + any future CommandDef additions)
	// to defineCommand automatically.
	const {
		args: zodArgs,
		flags: zodFlags,
		run: userRun,
		...passthrough
	} = config;

	const argSpecs = (zodArgs ?? []) as readonly ArgSpec[];
	const generatedArgs = argsToDefinitions(argSpecs);
	const generatedFlags = flagsToDefinitions(zodFlags);

	const command = defineCommand({
		...passthrough,
		...(generatedArgs.length > 0 && { args: generatedArgs }),
		...(Object.keys(generatedFlags).length > 0 && { flags: generatedFlags }),
		...(userRun && {
			run: buildRunHandler(
				argSpecs,
				zodFlags as Record<string, unknown> | undefined,
				userRun as ZodCommandRunHandler<unknown, unknown>,
				validateValue,
			),
		}),
	});

	return command;
}
