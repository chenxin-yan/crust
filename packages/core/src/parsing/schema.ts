import {
	normalizeStandardIssues,
	type StandardSchema,
	type ValidationIssue,
} from "@crustjs/utils/schema";

import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type { ArgsDef, FlagsDef, InferArgs, InferFlags, ParseResult } from "../types.ts";

async function runSchema(
	schema: StandardSchema,
	raw: unknown,
	path: readonly PropertyKey[],
	issues: ValidationIssue[],
): Promise<{ ok: boolean; value?: unknown }> {
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
	node: CommandNode,
	parsed: ParseResult<A, F>,
): Promise<{ args: InferArgs<A>; flags: InferFlags<F> }> {
	const issues: ValidationIssue[] = [];
	const args: InferArgs<A> = { ...parsed.args };
	const flags: InferFlags<F> = { ...parsed.flags };

	for (const def of node.args ?? []) {
		if (def.schema === undefined) continue;
		const result = await runSchema(
			def.schema,
			Reflect.get(args, def.name),
			["args", def.name],
			issues,
		);
		if (result.ok) Reflect.set(args, def.name, result.value);
	}

	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		if (def.schema === undefined) continue;
		const result = await runSchema(def.schema, Reflect.get(flags, name), ["flags", name], issues);
		if (result.ok) Reflect.set(flags, name, result.value);
	}

	if (issues.length > 0) {
		const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`);
		throw new CrustError("VALIDATION", `Invalid input:\n${lines.join("\n")}`, { issues });
	}

	return { args, flags };
}
