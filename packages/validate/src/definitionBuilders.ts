import type { ArgDef, FlagsDef } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { isFlagSpec } from "./flagSpec.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────────────────────

/** Resolved CLI input shape for a schema — used by both Zod and Effect providers. */
export interface InputShape {
	type: "string" | "number" | "boolean";
	multiple: boolean;
}

/** Minimal shape of an `arg()` spec that both providers produce. */
interface ArgSpecLike {
	readonly name: string;
	readonly schema: unknown;
	readonly variadic: true | undefined;
}

/**
 * Provider-specific adapter that bridges schema introspection into the
 * shared definition builders.
 *
 * Each provider implements these methods using its own schema internals
 * (Zod's runtime duck-typing vs. Effect's AST walking).
 */
export interface DefinitionAdapter {
	/** Resolve the CLI input shape (type + multiple) from a schema. */
	resolveInputShape(schema: unknown, label: string): InputShape;
	/** Check whether the schema accepts `undefined` as input. */
	isOptionalInputSchema(schema: unknown): boolean;
	/** Walk schema wrappers to find a description annotation. */
	resolveDescription(schema: unknown): string | undefined;
	/** Label used in error messages (e.g. `"defineZodCommand"`). */
	commandLabel: string;
	/** Schema-library hint for array wrappers (e.g. `"z.array(...)"`). */
	arrayHint: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared definition builders
// ────────────────────────────────────────────────────────────────────────────

/** Build Crust positional arg definitions from ordered `arg()` specs. */
export function buildArgDefinitions(
	args: readonly ArgSpecLike[],
	adapter: DefinitionAdapter,
): ArgDef[] {
	const seen = new Set<string>();

	for (let i = 0; i < args.length; i++) {
		const spec = args[i];
		if (!spec) continue;

		if (seen.has(spec.name)) {
			throw new CrustError(
				"DEFINITION",
				`${adapter.commandLabel}: duplicate arg name "${spec.name}"`,
			);
		}
		seen.add(spec.name);

		if (spec.variadic && i !== args.length - 1) {
			throw new CrustError(
				"DEFINITION",
				`${adapter.commandLabel}: only the last arg can be variadic (arg "${spec.name}")`,
			);
		}
	}

	return args.map((spec) => {
		const shape = adapter.resolveInputShape(spec.schema, `arg "${spec.name}"`);

		if (spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": variadic args must use a scalar schema; do not wrap the schema in ${adapter.arrayHint}`,
			);
		}

		if (!spec.variadic && shape.multiple) {
			throw new CrustError(
				"DEFINITION",
				`arg "${spec.name}": array schema requires { variadic: true }`,
			);
		}

		const description = adapter.resolveDescription(spec.schema);
		const required = !adapter.isOptionalInputSchema(spec.schema);

		const def: ArgDef = {
			name: spec.name,
			type: shape.type,
			...(description !== undefined && { description }),
			...(spec.variadic && { variadic: true }),
			...(required && { required: true }),
		};

		return def;
	});
}

/** Extract flag metadata (schema + alias) from a plain schema or `flag()` wrapper. */
function getFlagMetadata(value: unknown): {
	schema: unknown;
	alias?: string | readonly string[];
} {
	if (isFlagSpec(value)) {
		return { schema: value.schema, alias: value.alias };
	}
	return { schema: value };
}

/** Build Crust flag definitions from schema-first `flags` shape. */
export function buildFlagDefinitions(
	flags: Record<string, unknown> | undefined,
	adapter: DefinitionAdapter,
): FlagsDef {
	if (!flags) {
		return {};
	}

	const result: FlagsDef = {};

	for (const [name, value] of Object.entries(flags)) {
		const metadata = getFlagMetadata(value);
		const { schema } = metadata;
		const shape = adapter.resolveInputShape(schema, `flag "--${name}"`);
		const required = !adapter.isOptionalInputSchema(schema);
		const description = adapter.resolveDescription(schema);

		// Convert readonly alias to mutable for core FlagDef compatibility
		const alias: string | string[] | undefined =
			metadata.alias === undefined
				? undefined
				: typeof metadata.alias === "string"
					? metadata.alias
					: [...metadata.alias];

		result[name] = {
			type: shape.type,
			...(shape.multiple && { multiple: true }),
			...(alias !== undefined && { alias }),
			...(description !== undefined && { description }),
			...(required && { required: true }),
		};
	}

	return result;
}
