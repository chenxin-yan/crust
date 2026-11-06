import {
	normalizeStandardIssues,
	type StandardJSONSchema,
	type StandardSchema,
	type ValidationIssue,
} from "@crustjs/utils/schema";

import { CrustError } from "../errors.ts";
import type { ArgsDef, FlagsDef, ParseResult, ValidatedInput } from "../types.ts";

async function runSchema(
	schema: StandardSchema,
	raw: unknown,
	path: readonly PropertyKey[],
	issues: ValidationIssue[],
): Promise<{ readonly ok: false } | { readonly ok: true; readonly value: unknown }> {
	// Standard Schema validation is async-capable, including promises from other realms.
	const result = await schema["~standard"].validate(raw);

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
	node: { args: A; effectiveFlags: F },
	parsed: Pick<ParseResult<A, F>, "args" | "flags">,
): Promise<ValidatedInput<A, F>> {
	const issues: ValidationIssue[] = [];
	const args = new Map<string, unknown>(Object.entries(parsed.args));
	const flags = new Map<string, unknown>(Object.entries(parsed.flags));

	for (const def of node.args) {
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

	// SAFETY: schema-backed keys were replaced by schema outputs above; callers own requiredness.
	return { args: Object.fromEntries(args), flags: Object.fromEntries(flags) } as ValidatedInput<
		A,
		F
	>;
}

/**
 * Validate a Command Action result against its `.output()` schema.
 *
 * @returns The schema output, which replaces the result
 * @throws {CrustError} `OUTPUT` listing every schema issue
 */
export async function applyOutputSchema(schema: StandardSchema, result: unknown): Promise<unknown> {
	const issues: ValidationIssue[] = [];
	const validated = await runSchema(schema, result, [], issues);
	if (validated.ok) return validated.value;
	const lines = issues.map((issue) =>
		issue.path === "" ? `  - ${issue.message}` : `  - ${issue.path}: ${issue.message}`,
	);
	throw new CrustError("OUTPUT", `Invalid command result:\n${lines.join("\n")}`, { issues });
}

/**
 * The draft 2020-12 JSON Schema of a Standard Schema's input or output type,
 * through its Standard JSON Schema `~standard.jsonSchema` converter.
 *
 * Returns `undefined` when the schema has no converter (e.g. a Valibot schema
 * not wrapped with `toStandardJsonSchema`) or the converter throws because the
 * type cannot be represented (e.g. a Zod transform's output).
 *
 * @example
 * ```ts
 * standardJsonSchema(z.object({ id: z.number() }), "output");
 * // => { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", … }
 * ```
 */
export function standardJsonSchema(
	schema: StandardSchema,
	direction: "input" | "output",
): Record<string, unknown> | undefined {
	// Standard JSON Schema is optional on a Standard Schema; check before calling.
	const props: Partial<StandardJSONSchema["~standard"]> = schema["~standard"];
	const jsonSchema = props.jsonSchema;
	if (typeof jsonSchema?.[direction] !== "function") return undefined;
	try {
		return jsonSchema[direction]({ target: "draft-2020-12" });
	} catch {
		return undefined;
	}
}
