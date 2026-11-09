import { type JsonValue, parseJsonValue } from "@crustjs/utils/json";

import { CrustError } from "../errors.ts";
import { coerceUrl } from "../parsing/coercers.ts";
import type { RunInputPayload, RunInputValue, ValueType } from "../types.ts";
import type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./snapshot.ts";

/**
 * JSON Schema fragment for one property of a command's JSON input. Schema-backed
 * definitions may carry any further keywords their JSON Schema declares.
 */
export interface CommandInputPropertySchema {
	readonly type?: "string" | "number" | "boolean" | "array";
	readonly description?: string;
	readonly format?: string;
	readonly enum?: readonly (string | boolean)[];
	readonly items?: CommandInputPropertySchema;
	readonly default?: unknown;
	readonly [keyword: string]: unknown;
}

/** JSON Schema for a command's input as one flat object keyed by arg and flag names. */
export interface CommandInputSchema {
	readonly type: "object";
	readonly properties: Readonly<Record<string, CommandInputPropertySchema>>;
	readonly required?: readonly string[];
}

/** Command input property whose strings reach the action as `rawArgs`, like tokens after `--`. */
export const RAW_INPUT_PROPERTY = "raw";

function valueSchema(
	type: ValueType | undefined,
	choices: readonly string[] | undefined,
): CommandInputPropertySchema {
	if (choices) return { type: "string", enum: [...choices] };
	switch (type) {
		case "json":
			return {};
		case "url":
			return { type: "string", format: "uri" };
		case "number":
			return { type: "number" };
		case "boolean":
			return { type: "boolean" };
		case "string":
		case "path":
		// Only schema-backed args omit `type`; custom `parse` and schemas without a
		// usable `inputSchema` map by their token type.
		case undefined:
			return { type: "string" };
	}
}

/** `$ref`, `$defs`, `$id`, … resolve against the schema's own root, which nesting would move. */
function hasRootKeyword(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	return Object.entries(value).some(
		([key, entry]) => (key.startsWith("$") && key !== "$comment") || hasRootKeyword(entry),
	);
}

/**
 * A schema-backed definition's `inputSchema` without `$schema`, when `run()`
 * accepts what it describes: schema-backed values bind as their token, a string
 * (a boolean for `type: "boolean"`), in an array for variadic and `multiple`.
 */
function schemaPropertySchema(
	def: ArgSnapshot | FlagSnapshot,
	list: boolean,
): CommandInputPropertySchema | undefined {
	if (def.inputSchema === undefined) return undefined;
	const { $schema: _dialect, ...schema } = def.inputSchema;
	const token = def.type === "boolean" ? "boolean" : "string";
	const value = list ? schema.items : schema;
	// `prefixItems` constrains leading elements that `items` does not cover.
	if (list && (schema.type !== "array" || "prefixItems" in schema)) return undefined;
	if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
	if (value.type !== token || hasRootKeyword(schema)) return undefined;
	return schema;
}

function propertySchema(
	def: ArgSnapshot | FlagSnapshot,
	list: boolean,
): CommandInputPropertySchema {
	const value = valueSchema(def.type, def.choices);
	const schema: CommandInputPropertySchema =
		schemaPropertySchema(def, list) ?? (list ? { type: "array", items: value } : value);
	let defaultValue: unknown;
	if (def.default !== undefined) {
		try {
			defaultValue = JSON.parse(
				JSON.stringify(def.default, (_key, entry) => {
					// JSON would publish a non-finite number as `null`, misstating the default.
					if (entry === Infinity || entry === -Infinity || Number.isNaN(entry)) {
						throw new TypeError("Non-finite number");
					}
					return entry;
				}),
			);
		} catch {
			// Advisory metadata must not break discovery; run() still owns the actual default.
		}
	}
	return {
		...schema,
		...(def.description === undefined || "description" in schema
			? {}
			: { description: def.description }),
		...(defaultValue === undefined || "default" in schema ? {} : { default: defaultValue }),
	};
}

function formatPath(path: readonly string[]): string {
	return path.length === 0 ? "<root>" : path.join(" ");
}

/**
 * JSON Schema for a command's input as one flat object: each arg and flag by
 * name (variadic and `multiple` as arrays), plus {@link RAW_INPUT_PROPERTY}.
 * Mapped from the snapshot's declared types, so custom `parse` definitions
 * appear as their token type, and only declared `required` definitions are
 * required. A Standard Schema definition appears as its `inputSchema` (without
 * `$schema`, filling in a missing `description`) when that describes what
 * `run()` accepts for it: top-level `type` `"string"` (`"boolean"` for
 * `type: "boolean"` flags), or `"array"` with such `items` (and no `prefixItems`)
 * for variadic and `multiple`, and no `$ref`, `$defs`, or other `$` keyword. Otherwise, e.g.
 * `z.coerce.number()` (JSON Schema `number`), it appears as its token type.
 * Defaults are `JSON.stringify` copies (`URL`s become
 * strings; nested `undefined`, functions, and symbols are dropped); defaults
 * that fail to serialize or hold non-finite numbers are omitted. `path` names the command in the error thrown when an arg and a flag
 * share a name, or a definition is named `raw`.
 */
export function commandInputSchema(
	command: CommandSnapshot,
	path: readonly string[],
): CommandInputSchema {
	// Null prototype: core allows definitions named `constructor` or `__proto__`,
	// which `in` and plain assignment would confuse with Object.prototype.
	const properties: Record<string, CommandInputPropertySchema> = Object.create(null);
	const required: string[] = [];
	const claim = (name: string, def: ArgSnapshot | FlagSnapshot, list: boolean) => {
		if (Object.hasOwn(properties, name) || name === RAW_INPUT_PROPERTY) {
			throw new Error(
				`Command "${formatPath(path)}" declares "${name}" more than once across args, flags, and "${RAW_INPUT_PROPERTY}"; command input is one flat object`,
			);
		}
		properties[name] = propertySchema(def, list);
		if (def.required === true) required.push(name);
	};
	for (const arg of command.args) claim(arg.name, arg, arg.variadic === true);
	for (const [name, flag] of Object.entries(command.flags)) {
		claim(name, flag, flag.multiple === true);
	}
	properties[RAW_INPUT_PROPERTY] = {
		type: "array",
		items: { type: "string" },
		description: "Passthrough values, received as `rawArgs`; they never fill arguments",
	};
	return required.length === 0
		? { type: "object", properties }
		: { type: "object", properties, required };
}

/** How a command's flat JSON input splits back into `run()` input. */
export interface CommandInputFields {
	/** Arg and flag names declared as `type: "url"`; their strings become `URL`s before `run()`. */
	readonly urlFields: readonly string[];
	/** Arg names; every other input property except `raw` is a flag. */
	readonly argNames: readonly string[];
}

/** Arg names and `url` field names of a command's flat JSON input, in declaration order. */
export function commandInputFields(command: CommandSnapshot): CommandInputFields {
	return {
		urlFields: [
			...command.args.filter((arg) => arg.type === "url").map((arg) => arg.name),
			...Object.entries(command.flags)
				.filter(([, flag]) => flag.type === "url")
				.map(([name]) => name),
		],
		argNames: command.args.map((arg) => arg.name),
	};
}

function isString(value: JsonValue): value is string {
	return typeof value === "string";
}

/**
 * Split flat JSON command input (the shape {@link commandInputSchema}
 * describes) into structured `run()` input. Arg names fill `args`; any other
 * name goes to `flags`, where `run()` rejects unknown ones. Strings for `url`
 * definitions become `URL`s, and `undefined` entries are skipped.
 *
 * @throws {CrustError} `PARSE` when a value is not JSON data, a `url` value is not a valid
 *   URL, or `raw` is not an array of strings
 */
export function parseCommandInput(
	command: CommandSnapshot,
	values: Readonly<Record<string, unknown>>,
): RunInputPayload {
	// Null prototypes so a `__proto__` definition binds as an own property.
	const args: Record<string, RunInputValue> = Object.create(null);
	const flags: Record<string, RunInputValue> = Object.create(null);
	const { argNames, urlFields } = commandInputFields(command);
	let raw: readonly string[] | undefined;
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) continue;
		let given: JsonValue;
		try {
			given = parseJsonValue(value);
		} catch {
			throw new CrustError("PARSE", `Expected a JSON value for "${name}"`);
		}
		if (name === RAW_INPUT_PROPERTY) {
			if (!Array.isArray(given) || !given.every(isString)) {
				throw new CrustError("PARSE", `Expected an array of strings for "${RAW_INPUT_PROPERTY}"`);
			}
			raw = given;
			continue;
		}
		const isArg = argNames.includes(name);
		const label = isArg ? `<${name}>` : `--${name}`;
		const toUrl = (item: JsonValue) => (isString(item) ? coerceUrl(item, label) : item);
		(isArg ? args : flags)[name] = urlFields.includes(name)
			? Array.isArray(given)
				? given.map(toUrl)
				: toUrl(given)
			: given;
	}
	return raw === undefined ? { args, flags } : { args, flags, raw };
}
