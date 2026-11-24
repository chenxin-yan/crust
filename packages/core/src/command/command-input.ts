import { type JsonValue, parseJsonValue } from "@crustjs/utils/json";

import { CrustError } from "../errors.ts";
import { coerceUrl } from "../parsing/coercers.ts";
import type { RunInputPayload, RunInputValue } from "../types.ts";
import type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./snapshot.ts";

/** A JSON Schema `type` name. */
type JsonSchemaTypeName = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

/**
 * JSON Schema fragment for one property of a command's JSON input. Schema-backed
 * definitions may carry any further keywords their JSON Schema declares.
 */
export interface CommandInputPropertySchema {
	readonly type?: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
	readonly description?: string;
	readonly format?: string;
	readonly enum?: readonly JsonValue[];
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

function valueSchema(def: ArgSnapshot | FlagSnapshot): CommandInputPropertySchema {
	if (def.choices) return { type: "string", enum: [...def.choices] };
	switch (def.type) {
		case "json":
			return {};
		case "url":
			return { type: "string", format: "uri" };
		case "count":
			return { type: "integer", minimum: 0 };
		case "number":
		case "integer":
			return {
				type: def.type,
				...(Number.isFinite(def.min) ? { minimum: def.min } : {}),
				...(Number.isFinite(def.max) ? { maximum: def.max } : {}),
			};
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

/** Keywords whose keys are names; only their values are schemas. */
const NAMED_SCHEMA_KEYWORDS = new Set([
	"properties",
	"patternProperties",
	"definitions",
	"dependentSchemas",
]);
/** Keywords whose values are data, not schemas. */
const DATA_KEYWORDS = new Set(["const", "enum", "default", "examples"]);

/** `$ref`, `$defs`, `$id`, … resolve against the schema's own root, which nesting would move. */
function hasRootKeyword(schema: unknown): boolean {
	if (typeof schema !== "object" || schema === null) return false;
	if (Array.isArray(schema)) return schema.some(hasRootKeyword);
	return Object.entries(schema).some(([key, entry]) => {
		if (key.startsWith("$")) return key !== "$comment";
		if (DATA_KEYWORDS.has(key)) return false;
		if (NAMED_SCHEMA_KEYWORDS.has(key) && typeof entry === "object" && entry !== null) {
			return Object.values(entry).some(hasRootKeyword);
		}
		return hasRootKeyword(entry);
	});
}

/**
 * A schema-backed definition's `inputSchema` without `$schema`, when `run()`
 * accepts what it describes: schema-backed values bind as their token, a string
 * (a boolean for `type: "boolean"`), in an array for variadic and `multiple`;
 * a json flag binds the JSON value itself, so any JSON Schema describes it.
 */
function schemaPropertySchema(
	def: ArgSnapshot | FlagSnapshot,
	list: boolean,
): CommandInputPropertySchema | undefined {
	if (def.inputSchema === undefined) return undefined;
	const { $schema: _dialect, ...schema } = def.inputSchema;
	if (def.type === "json") return hasRootKeyword(schema) ? undefined : schema;
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
	const value = valueSchema(def);
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
	const env = "env" in def && def.env ? [def.env].flat().map((variable) => `$${variable}`) : [];
	const declared = "description" in schema ? schema.description : def.description;
	const description =
		env.length === 0
			? declared
			: typeof declared === "string"
				? `${declared} (falls back to ${env.join(", ")})`
				: `Falls back to ${env.join(", ")}`;
	return {
		...schema,
		...(description === undefined ? {} : { description }),
		...(defaultValue === undefined || "default" in schema ? {} : { default: defaultValue }),
	};
}

/** Extension flags (`--help`, `--json`, `--input`, …) configure the invocation, not the command. */
function commandInputFlags(command: CommandSnapshot): [string, FlagSnapshot][] {
	return Object.entries(command.flags).filter(([, flag]) => flag.extension === undefined);
}

function formatPath(path: readonly string[]): string {
	return path.length === 0 ? "<root>" : path.join(" ");
}

/**
 * JSON Schema for a command's input as one flat object: each arg and flag by
 * name (variadic and `multiple` as arrays).
 * Flags an Extension declares (`--help`, `--json`, `--input`, …; see
 * {@link FlagSnapshot.extension}) are left out; Context-owned flags such as
 * `--yes` stay. Mapped from the snapshot's
 * declared types, so custom `parse` definitions appear as their token type, and
 * only declared `required` definitions are required, except flags with an `env`
 * binding: the variable may supply them, so they are optional and their
 * description names it. A Standard Schema definition appears as its `inputSchema` (without
 * `$schema`, filling in a missing `description`) when that describes what
 * `run()` accepts for it: top-level `type` `"string"` (`"boolean"` for
 * `type: "boolean"` flags), or `"array"` with such `items` (and no `prefixItems`)
 * for variadic and `multiple`, and no `$ref`, `$defs`, or other `$` keyword. Otherwise, e.g.
 * `z.coerce.number()` (JSON Schema `number`), it appears as its token type.
 * Defaults are `JSON.stringify` copies (`URL`s become
 * strings; nested `undefined`, functions, and symbols are dropped); defaults
 * that fail to serialize or hold non-finite numbers are omitted. `path` names the command in the error thrown when an arg and a flag
 * share a name.
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
		if (Object.hasOwn(properties, name)) {
			throw new Error(
				`Command "${formatPath(path)}" declares "${name}" more than once across args and flags; command input is one flat object`,
			);
		}
		properties[name] = propertySchema(def, list);
		if (def.required === true && !("env" in def && def.env)) required.push(name);
	};
	for (const arg of command.args) claim(arg.name, arg, arg.variadic !== undefined);
	for (const [name, flag] of commandInputFlags(command)) {
		claim(name, flag, flag.multiple === true);
	}
	return required.length === 0
		? { type: "object", properties }
		: { type: "object", properties, required };
}

/** How a command's flat JSON input splits back into `run()` input. */
export interface CommandInputFields {
	/** Arg and flag names declared as `type: "url"`; their strings become `URL`s before `run()`. */
	readonly urlFields: readonly string[];
	/** Arg names; every other input property is a flag. */
	readonly argNames: readonly string[];
}

/** Not "Unknown flag": help lists the flag and argv takes it. */
function notCommandInput(name: string): CrustError {
	return new CrustError(
		"PARSE",
		`Flag "--${name}" is not command input: set it on the command line`,
		{ flag: name, reason: "unknown-flag" },
	);
}

/** Arg names and `url` field names of a command's flat JSON input, in declaration order. */
export function commandInputFields(command: CommandSnapshot): CommandInputFields {
	return {
		urlFields: [
			...command.args.filter((arg) => arg.type === "url").map((arg) => arg.name),
			...commandInputFlags(command)
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
 * definitions become `URL`s, and `undefined` entries are skipped. A key naming
 * a flag an Extension declares, and no arg, is rejected, since command
 * input leaves it out, so such a key never selects a flag handler or reaches its Extension.
 *
 * @throws {CrustError} `PARSE` when a key names an Extension flag, a value is not JSON data,
 *   or a `url` value is not a valid URL
 */
export function parseCommandInput(
	command: CommandSnapshot,
	values: Readonly<Record<string, unknown>>,
): RunInputPayload {
	// Null prototypes so a `__proto__` definition binds as an own property.
	const args: Record<string, RunInputValue> = Object.create(null);
	const flags: Record<string, RunInputValue> = Object.create(null);
	const { argNames, urlFields } = commandInputFields(command);
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) continue;
		const isArg = argNames.includes(name);
		// Args win over a same-named Extension flag, matching commandInputSchema.
		if (
			!isArg &&
			Object.hasOwn(command.flags, name) &&
			command.flags[name]!.extension !== undefined
		) {
			throw notCommandInput(name);
		}
		let given: JsonValue;
		try {
			given = parseJsonValue(value);
		} catch {
			throw new CrustError("PARSE", `Expected a JSON value for "${name}"`);
		}
		const label = isArg ? `<${name}>` : `--${name}`;
		const toUrl = (item: JsonValue) => (isString(item) ? coerceUrl(item, label) : item);
		(isArg ? args : flags)[name] = urlFields.includes(name)
			? Array.isArray(given)
				? given.map(toUrl)
				: toUrl(given)
			: given;
	}
	return { args, flags };
}
