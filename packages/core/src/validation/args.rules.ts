import { CrustError } from "../errors.ts";
import type { ArgDef, ArgsDef, FlagDef } from "../types.ts";

/** Schema mode is exclusive because the schema owns value semantics. */
export function schemaExclusivity(
	subject: "arg" | "flag",
	name: string,
	def: ArgDef | FlagDef,
): void {
	if (def.schema === undefined) return;
	for (const key of ["default", "required", "choices", "parse"] as const) {
		if (def[key] !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${subject} "${name}" mixes core option "${key}" with a schema — the schema exclusively owns coercion, defaults, requiredness, choices, and validation`,
				{ subject, name, reason: "schema-exclusive" },
			);
		}
	}
	if (subject === "arg" && def.type !== undefined) {
		throw new CrustError(
			"DEFINITION",
			`arg "${name}" mixes core option "type" with a schema — schema args receive the raw string token`,
			{ subject, name, reason: "schema-exclusive" },
		);
	}
}

/** Custom parsers are consumed synchronously during argv parsing. */
export function asyncParse(
	parse: ((raw: string) => unknown) | undefined,
	subject: "flag" | "arg",
	name: string,
): void {
	if (parse?.constructor.name !== "AsyncFunction") return;
	const label = subject === "flag" ? `flag --${name}` : `argument <${name}>`;
	throw new CrustError(
		"DEFINITION",
		`Async parse not supported for ${label}. Use a sync parser; do async work in run().`,
		{ subject, name, reason: "async-parse" },
	);
}

/** Every argument and flag definition must carry a non-empty name. */
export function nonEmptyName(name: string, subject: "arg" | "flag"): void {
	if (typeof name === "string" && name.length > 0) return;
	throw new CrustError(
		"DEFINITION",
		`Every ${subject === "arg" ? "argument" : "flag"} definition must carry a non-empty name`,
		{ subject, reason: "missing-name" },
	);
}

/** Argument names are unique across appended argument definitions. */
export function duplicateArg(name: string, existing: ReadonlySet<string>): void {
	if (!existing.has(name)) return;
	throw new CrustError("DEFINITION", `Argument "${name}" is already defined`, {
		subject: "arg",
		name,
		reason: "duplicate-arg",
	});
}

/** Only the final positional argument may be variadic. */
export function variadicPosition(def: ArgsDef[number], index: number, count: number): void {
	if (def.variadic === true && index !== count - 1) {
		throw new CrustError(
			"DEFINITION",
			`Argument "${def.name}" is variadic, but only the last positional argument can be variadic`,
			{ subject: "arg", name: def.name, reason: "variadic-position" },
		);
	}
}

/** Defaults constrained by choices must name an allowed value. */
export function defaultWithinChoices(
	def: { default?: unknown; choices?: readonly string[] },
	label: string,
	subject: "flag" | "arg",
	name: string,
): void {
	const { default: value, choices } = def;
	if (value === undefined || choices === undefined) return;
	const values = Array.isArray(value) ? value : [value];
	for (const item of values) {
		if (choices.includes(String(item))) continue;
		throw new CrustError(
			"DEFINITION",
			`Invalid default value "${String(item)}" for ${label}. Expected one of: ${choices.join(", ")}`,
			{ subject, name, reason: "default-choice" },
		);
	}
}
