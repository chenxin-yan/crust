import type { BuildArtifacts, CommandSnapshot, FlagSnapshot } from "@crustjs/core";
import { commandInputSchema } from "@crustjs/core/tooling";

type Shape = Readonly<Record<string, unknown>>;

/** One flag that declares a config key. */
interface KeyUse {
	/** `<command path> --<flag>`, as the build error names it. */
	readonly label: string;
	readonly shape: Shape;
	readonly description?: string;
}

/** Names the JSON Schema a config file follows; never a flag's key. */
const SCHEMA_KEY = "$schema";

/**
 * The value a flag accepts, as `commandInputSchema()` publishes it (a custom `parse` as its token
 * type), without `description` and `default`.
 */
function shapeOf(command: CommandSnapshot, path: readonly string[], flag: FlagSnapshot): Shape {
	// One flag at a time, and without `extension`, which command input leaves out.
	const { extension: _extension, ...def } = flag;
	const schema = commandInputSchema({ ...command, args: [], flags: { value: def } }, path);
	const { description: _description, default: _default, ...shape } = schema.properties.value!;
	return shape;
}

/** Every flag with a config key, by key, in command-tree order. */
function collectUses(
	command: CommandSnapshot,
	path: readonly string[],
	uses: Map<string, KeyUse[]>,
): void {
	for (const [name, flag] of Object.entries(command.flags)) {
		if (flag.config === undefined) continue;
		const use = {
			label: `${path.join(" ")} --${name}`,
			shape: shapeOf(command, path, flag),
			description: flag.description,
		};
		uses.set(flag.config, [...(uses.get(flag.config) ?? []), use]);
	}
	for (const [name, sub] of Object.entries(command.subCommands)) {
		collectUses(sub, [...path, name], uses);
	}
}

/** JSON with object keys sorted, so equal shapes compare equal whatever their key order. */
function canonical(shape: unknown): string {
	return JSON.stringify(shape, (_key, value: unknown) =>
		typeof value === "object" && value !== null && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
			: value,
	);
}

/** A shape in words for the build error; JSON for anything but the shapes plain flags have. */
function inWords(shape: Shape): string {
	const keys = Object.keys(shape).sort().join();
	const { type, format, items } = shape;
	if (keys === "") return "any JSON value";
	if (keys === "type" && typeof type === "string") return type;
	if (keys === "format,type" && type === "string" && format === "uri") return "URL";
	if (keys === "enum,type" && type === "string" && Array.isArray(shape.enum)) {
		return `string (${shape.enum.map((value) => JSON.stringify(value)).join(" | ")})`;
	}
	if (keys === "items,type" && type === "array" && typeof items === "object" && items !== null) {
		return `array of ${inWords(items as Shape)}`;
	}
	return JSON.stringify(shape);
}

/**
 * `config/schema.json`, a JSON Schema of the config file, for an app whose flags declare config
 * keys; nothing otherwise. Throws one error naming every key whose flags accept different values,
 * since one file serves every command, and every flag that declares the key `$schema`.
 */
export function configBuildArtifacts(snapshot: CommandSnapshot): BuildArtifacts {
	const uses = new Map<string, KeyUse[]>();
	collectUses(snapshot, [snapshot.meta.name], uses);
	if (uses.size === 0) return [];
	const problems: string[] = [];
	let count = 0;
	// Null prototype: a key may be `__proto__`, which plain assignment would treat as the prototype.
	const properties: Record<string, Shape> = Object.create(null);
	properties[SCHEMA_KEY] = { type: "string", description: "The JSON Schema this file follows" };
	for (const [key, keyUses] of uses) {
		const listed = keyUses.map(({ label, shape }) => `    ${label}  ${inWords(shape)}`);
		if (key === SCHEMA_KEY) {
			count++;
			problems.push(
				`  config key "${key}" names the JSON Schema of the config file:`,
				...listed,
				"    fix: give the flag another key",
			);
			continue;
		}
		const [first] = keyUses as [KeyUse];
		if (keyUses.some(({ shape }) => canonical(shape) !== canonical(first.shape))) {
			count++;
			problems.push(
				`  config key "${key}" is declared with different types:`,
				...listed,
				"    fix: give them one type, or give one of them another key",
			);
			continue;
		}
		const description = keyUses.find((use) => use.description !== undefined)?.description;
		properties[key] = description === undefined ? first.shape : { ...first.shape, description };
	}
	if (count > 0) {
		const need = count === 1 ? "1 problem needs" : `${count} problems need`;
		throw new Error(
			[`config: ${need} a decision before this CLI can be built.`, "", ...problems].join("\n"),
		);
	}
	const schema = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: `${snapshot.meta.name} config file`,
		type: "object",
		properties,
		additionalProperties: false,
	};
	return [{ path: "config/schema.json", content: `${JSON.stringify(schema, null, "\t")}\n` }];
}
