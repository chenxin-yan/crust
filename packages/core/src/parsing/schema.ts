import {
	normalizeStandardIssues,
	type InferOutput,
	type StandardSchema,
	type ValidationIssue,
} from "@crustjs/utils/schema";

import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type { ArgsDef, FlagsDef, ParseResult, ValidatedInput } from "../types.ts";

async function runSchema<S extends StandardSchema, Raw>(
	schema: S,
	raw: Raw,
	path: readonly PropertyKey[],
	issues: ValidationIssue[],
): Promise<{ readonly ok: false } | { readonly ok: true; readonly value: InferOutput<S> }> {
	let result = schema["~standard"].validate(raw);
	if (result instanceof Promise) result = await result;

	if (result.issues) {
		issues.push(...normalizeStandardIssues(result.issues, path));
		return { ok: false };
	}
	return { ok: true, value: result.value };
}

/**
 * Apply Standard Schemas declared on arg/flag definitions.
 *
 * Runs after syntax parsing and structural validation: each schema receives
 * the raw parsed value (`string | undefined` for args, the raw token value
 * for flags, arrays for variadic/multiple) and exclusively owns coercion,
 * defaults, requiredness, and validation. Returns transformed copies of
 * `args`/`flags`; definitions without a schema pass through unchanged.
 *
 * @throws {CrustError} `VALIDATION` aggregating every schema issue
 */
export async function applySchemas<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	node: CommandNode & { args: A | undefined; effectiveFlags: F },
	parsed: ParseResult<A, F>,
): Promise<ValidatedInput<A, F>> {
	const issues: ValidationIssue[] = [];
	const args = new Map<string, unknown>(Object.entries(parsed.args));
	const flags = new Map<string, unknown>(Object.entries(parsed.flags));

	for (const def of node.args ?? []) {
		if (def.schema === undefined) continue;
		const result = await runSchema(def.schema, args.get(def.name), ["args", def.name], issues);
		if (result.ok) args.set(def.name, result.value);
	}

	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		if (def.schema === undefined) continue;
		const result = await runSchema(def.schema, flags.get(name), ["flags", name], issues);
		if (result.ok) flags.set(name, result.value);
	}

	if (issues.length > 0) {
		const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`);
		throw new CrustError("VALIDATION", `Invalid input:\n${lines.join("\n")}`, { issues });
	}

	// SAFETY: schema-backed keys were replaced by schema outputs above; callers run
	// validateParsed before this boundary (dispatch ordering), which owns requiredness.
	return { args: Object.fromEntries(args), flags: Object.fromEntries(flags) } as ValidatedInput<
		A,
		F
	>;
}
