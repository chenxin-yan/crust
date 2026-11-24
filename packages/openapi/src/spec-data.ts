// The data files `crust build` writes for a URL spec below its artifact directory, beside the whole
// spec: an index of the generated top-level commands, which a built CLI reads at start, and the part
// of the spec each top-level group needs, which its command reads when first used.
import { type CommandConfig, type CommandSnapshot, defineCommand } from "@crustjs/core";

import type { OpenApiSpec } from "./api-command.ts";
import {
	type AddedCommands,
	type GenerateOptions,
	type GeneratedDefinition,
	groupChildren,
	groupMeta,
	groupTree,
	operationCommand,
	type OperationMeta,
	operationMeta,
} from "./commands.ts";
import type { CommandPlan } from "./lint.ts";
import { kebab } from "./names.ts";
import type { Operation } from "./operations.ts";
import { commandExtras } from "./overrides.ts";
import { record } from "./schema.ts";
import { BUILT_SPEC_FILE } from "./spec-source.ts";
import { METHODS, isLocalRef, pointerKeys } from "./spec-traversal.ts";

export const INDEX_FILE = "index.json";
// The layout this version writes and reads; a built CLI rejects an index of another.
const INDEX_VERSION = 1;
const ROOT_FILE = "root.json";
// A spec whose `$ref`s are so connected that each group reaches most of it (Stripe's) would ship
// it many times over; past this many times its size, every command reads the whole spec instead.
const MAX_SLICES_RATIO = 2;
// A group file's name keeps this many characters of the group's, far below file system limits.
const MAX_FILE_NAME = 64;

/** What a built CLI reads at start: enough to add the generated top-level commands without a slice. */
export interface SpecIndex {
	readonly version: typeof INDEX_VERSION;
	/** The generated root commands, in order. */
	readonly commands: readonly {
		readonly name: string;
		/** Its metadata, with the override's package keys (`CommandExtras`) as JSON. */
		readonly meta: OperationMeta;
		readonly operationId: string;
		/** The data file its operation is read from. */
		readonly file: string;
	}[];
	/** The top-level groups, in order; a group of added commands only has no operations and no `file`. */
	readonly groups: readonly {
		readonly name: string;
		readonly meta: Pick<CommandConfig, "description">;
		/** Its generated commands' operations, at any depth. */
		readonly operationIds: readonly string[];
		readonly file?: string;
	}[];
}

/**
 * The data files for the generated commands `plans` and the added commands `added`, by path below
 * the artifact directory: `index.json`, `root.json` for the root commands and a slice per top-level
 * group (`groups/g-<name>.json`), each the part of `spec` its operations need. When the slices would
 * total more than twice `specText` (the spec as `spec.json` holds it), the index points every
 * command at `spec.json` and no slice is written.
 */
export function specDataFiles(
	spec: OpenApiSpec,
	specText: string,
	plans: readonly CommandPlan[],
	added: readonly AddedCommands[],
): Map<string, string> {
	const tree = groupTree(plans, added);
	const byGroup = Map.groupBy(
		plans.filter(({ group }) => group !== ""),
		({ group }) => group.split(" ")[0]!,
	);
	const files = groupFiles([...byGroup.keys()]);
	// An override's output schema may `$ref` what none of its operations does.
	const slice = (planned: readonly CommandPlan[]) =>
		JSON.stringify(
			sliceSpec(
				spec,
				planned.map(({ op }) => op),
				planned.flatMap(({ fields }) => fields.outputSchema ?? []),
			),
		);
	const slices = new Map<string, string>();
	if (tree.plans.length > 0) slices.set(ROOT_FILE, slice(tree.plans));
	for (const [group, groupPlans] of byGroup) slices.set(files.get(group)!, slice(groupPlans));
	const { Buffer } = process.getBuiltinModule("node:buffer");
	let size = 0;
	for (const text of slices.values()) size += Buffer.byteLength(text);
	const whole = size > MAX_SLICES_RATIO * Buffer.byteLength(specText);
	const fileOf = (file: string) => (whole ? BUILT_SPEC_FILE : file);
	const index: SpecIndex = {
		version: INDEX_VERSION,
		commands: tree.plans.map((plan) => ({
			name: plan.name,
			meta: operationMeta(plan),
			operationId: plan.op.id,
			file: fileOf(ROOT_FILE),
		})),
		groups: [...tree.groups.keys()].map((name) => {
			const file = files.get(name);
			return {
				name,
				meta: groupMeta(spec, name),
				operationIds: (byGroup.get(name) ?? []).map(({ op }) => op.id),
				...(file !== undefined && { file: fileOf(file) }),
			};
		}),
	};
	return new Map([[INDEX_FILE, JSON.stringify(index)], ...(whole ? [] : slices)]);
}

/**
 * Each group's file name: `groups/g-<kebab-case name>.json`, which no Windows device name can be,
 * a long name cut short and ended by a hash of the group's, and `.2`, `.3`... after it for names
 * that come out alike (also by case), numbered in code unit order of the names so every build and
 * platform agrees.
 */
function groupFiles(groups: readonly string[]): Map<string, string> {
	const taken = new Map<string, number>();
	const files = new Map<string, string>();
	for (const group of [...groups].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
		const words = kebab(group);
		const short =
			words.length <= MAX_FILE_NAME
				? words
				: `${words.slice(0, MAX_FILE_NAME)}-${process.getBuiltinModule("node:crypto").createHash("sha256").update(group).digest("hex").slice(0, 12)}`;
		const name = `g-${short}`;
		const count = (taken.get(name) ?? 0) + 1;
		taken.set(name, count);
		files.set(group, `groups/${count === 1 ? name : `${name}.${count}`}.json`);
	}
	return files;
}

/**
 * The part of `spec` the `operations` need, which the operation model reads them from as from the
 * spec: its `openapi`, `swagger` and `security`; each operation's path item with only those
 * operations among its own methods and its `$ref` kept, so it resolves as in the spec (its own
 * methods and fields over its target's), with its other own methods, when it has a `$ref`, replaced
 * by placeholders that are no operation and still hide the target's; and every local `$ref` target reached from them, at the same pointer, also from `roots`
 * (other values whose `$ref`s must resolve). So a slice's operations are some of the spec's, at the
 * same paths, and include `operations`. No `tags`: kebab-case names have no spaces, so only a
 * top-level group matches a tag, and the index holds its description.
 */
function sliceSpec(
	spec: OpenApiSpec,
	operations: readonly Pick<Operation, "method" | "path">[],
	roots: readonly unknown[] = [],
): OpenApiSpec {
	const methods = new Set<string>(METHODS);
	const kept = Map.groupBy(operations, ({ path }) => path);
	const paths: Record<string, unknown> = {};
	for (const [path, item] of Object.entries(spec.paths ?? {})) {
		const own = kept.get(path);
		if (own === undefined || typeof item !== "object" || item === null) continue;
		const referencing = Object.hasOwn(item, "$ref");
		put(
			paths,
			path,
			Object.fromEntries(
				Object.entries(item).flatMap(([key, value]) =>
					!methods.has(key) || own.some(({ method }) => method === key)
						? [[key, value]]
						: // A method left out must still hide its `$ref` target's, as it does in the spec: a
							// deprecated operation without an operationId is none, and is not reported.
							referencing
							? [[key, { deprecated: true }]]
							: [],
				),
			),
		);
	}
	const slice: Record<string, unknown> = {};
	for (const key of ["openapi", "swagger", "security"]) {
		if (Object.hasOwn(spec, key)) slice[key] = spec[key];
	}
	slice.paths = paths;

	const refs = new Set<string>();
	const walked = new WeakSet<object>();
	const pending: unknown[] = [paths, ...roots];
	while (pending.length > 0) {
		const value = pending.pop();
		if (typeof value !== "object" || value === null || walked.has(value)) continue;
		walked.add(value);
		const ref: unknown = (value as { $ref?: unknown }).$ref;
		if (isLocalRef(ref) && !refs.has(ref)) {
			refs.add(ref);
			const keys = pointerKeys(ref);
			// `#` is the whole document.
			if (keys?.length === 0) return spec;
			const target = keys === undefined ? undefined : copyTarget(spec, slice, keys);
			if (target !== undefined) pending.push(target);
		}
		for (const child of Object.values(value)) pending.push(child);
	}
	return slice;
}

/**
 * Copies the value at `keys` in `spec` to the same place in `slice`, creating the objects and arrays
 * on the way, and returns it; `undefined` when it does not exist or `slice` already holds it.
 */
function copyTarget(spec: OpenApiSpec, slice: Record<string, unknown>, keys: readonly string[]) {
	let source: unknown = spec;
	let target: Record<string, unknown> = slice;
	for (const [position, key] of keys.entries()) {
		if (typeof source !== "object" || source === null || !Object.hasOwn(source, key)) {
			return undefined;
		}
		const next: unknown = (source as Record<string, unknown>)[key];
		const held = Object.hasOwn(target, key) ? target[key] : undefined;
		// The spec's own value is there, with everything below it.
		if (held === next) return undefined;
		if (position === keys.length - 1) {
			put(target, key, next);
			return next;
		}
		if (typeof next !== "object" || next === null) return undefined;
		if (held === undefined) put(target, key, Array.isArray(next) ? [] : {});
		source = next;
		target = target[key] as Record<string, unknown>;
	}
	return undefined;
}

/** Sets an own property, also one named `__proto__`. */
function put(target: object, key: string, value: unknown): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

/** Whether `value`, read from a built CLI's `index.json`, is an index of this version's layout. */
export function isSpecIndex(value: unknown): value is SpecIndex {
	const text = (field: unknown) => typeof field === "string";
	const isMeta = (field: unknown) => {
		const meta = record(field);
		return (
			meta !== undefined &&
			(meta.description === undefined || text(meta.description)) &&
			(meta.hidden === undefined || typeof meta.hidden === "boolean")
		);
	};
	const index = record(value);
	return (
		index?.version === INDEX_VERSION &&
		Array.isArray(index.commands) &&
		index.commands.every((entry) => {
			const command = record(entry);
			return (
				command !== undefined &&
				text(command.name) &&
				isMeta(command.meta) &&
				text(command.operationId) &&
				text(command.file)
			);
		}) &&
		Array.isArray(index.groups) &&
		index.groups.every((entry) => {
			const group = record(entry);
			return (
				group !== undefined &&
				text(group.name) &&
				isMeta(group.meta) &&
				Array.isArray(group.operationIds) &&
				group.operationIds.every(text) &&
				(group.file === undefined || text(group.file))
			);
		})
	);
}

/**
 * `spec` as the operation model reads only the operations `operationIds` from it: every other
 * operation of its `paths` is copied without its operationId, which leaves it out, and the rest of
 * the spec stays, so every `$ref` resolves as before.
 */
export function onlyOperations(spec: OpenApiSpec, operationIds: ReadonlySet<string>): OpenApiSpec {
	const methods = new Set<string>(METHODS);
	const paths: Record<string, unknown> = {};
	for (const [path, item] of Object.entries(spec.paths ?? {})) {
		const entries = record(item);
		put(
			paths,
			path,
			entries === undefined
				? item
				: Object.fromEntries(
						Object.entries(entries).map(([key, value]) => {
							const operation = methods.has(key) ? record(value) : undefined;
							const { operationId } = operation ?? {};
							if (typeof operationId !== "string" || operationIds.has(operationId)) {
								return [key, value];
							}
							const { operationId: _operationId, ...rest } = operation!;
							return [key, rest];
						}),
					),
		);
	}
	return { ...spec, paths };
}

/** A data file of a built CLI, and the plans of generated operations in it. */
export interface DataFile {
	readonly spec: OpenApiSpec;
	readonly plans: (operationIds: readonly string[]) => CommandPlan[];
}

/**
 * The generated top-level commands of a built CLI, from its index: each reads its data file, through
 * `planned`, only when its recipe runs. `added` are the app's own commands, as for the whole spec.
 */
export function indexedCommands(
	index: SpecIndex,
	added: readonly AddedCommands[],
	options: Omit<GenerateOptions, "spec">,
	planned: (file: string) => DataFile,
): GeneratedDefinition[] {
	return [
		...index.commands.map(({ name, meta, operationId, file }) =>
			operationCommand(name, meta, () => {
				const { spec, plans } = planned(file);
				return { plan: plans([operationId])[0]!, options: { ...options, spec } };
			}),
		),
		...groupTree([], added).added,
		...index.groups.map(({ name, meta, operationIds, file }) =>
			defineCommand(name, meta, (command) => {
				let spec: OpenApiSpec = {};
				let plans: CommandPlan[] = [];
				if (file !== undefined) {
					const data = planned(file);
					spec = data.spec;
					plans = data.plans(operationIds);
				}
				const node = groupTree(plans, added).groups.get(name) ?? groupTree([], []);
				return command.add(...groupChildren(node, name, { ...options, spec }));
			}),
		),
	];
}

/**
 * The paths (such as `"users list"`) of the planned commands the app lacks, or holds with other
 * arguments or without their flags, below the command that holds the most of them (any command,
 * since `acme.commands` may be added below one); `undefined` when the app holds none of them.
 */
export function missingCommands(
	snapshot: CommandSnapshot,
	plans: readonly CommandPlan[],
): string[] | undefined {
	if (plans.length === 0) return [];
	const pathOf = ({ group, name }: CommandPlan) => (group === "" ? name : `${group} ${name}`);
	const tops = new Set(plans.map((plan) => pathOf(plan).split(" ")[0]!));
	let fewest: string[] | undefined;
	const nodes = [snapshot];
	for (const node of nodes) {
		const children = Object.keys(node.subCommands);
		if (children.some((name) => tops.has(name))) {
			const missing = plans.flatMap((plan) => (holds(node, plan) ? [] : [pathOf(plan)]));
			if (fewest === undefined || missing.length < fewest.length) fewest = missing;
		}
		nodes.push(...Object.values(node.subCommands));
	}
	return fewest === undefined || fewest.length === plans.length ? undefined : fewest;
}

/** Whether `node` holds the planned command, as {@link isPlannedCommand} tells, at the plan's path below it. */
function holds(node: CommandSnapshot, plan: CommandPlan): boolean {
	let command: CommandSnapshot | undefined = node;
	for (const word of [...(plan.group === "" ? [] : plan.group.split(" ")), plan.name]) {
		command = Object.hasOwn(command.subCommands, word) ? command.subCommands[word] : undefined;
		if (command === undefined) return false;
	}
	return isPlannedCommand(command, plan);
}

/**
 * Whether `command` is the planned command: it declares `.output()` and has the plan's description,
 * hidden state, package keys and arguments, and at least its flags.
 */
export function isPlannedCommand(command: CommandSnapshot, plan: CommandPlan): boolean {
	const args = plan.inputs.filter(({ kind }) => kind === "arg").map(({ name }) => name);
	const { name: _name, description, hidden, ...extras } = command.meta;
	const meta = operationMeta(plan);
	return (
		command.output === true &&
		description === meta.description &&
		(hidden === true) === (meta.hidden === true) &&
		process.getBuiltinModule("node:util").isDeepStrictEqual(extras, commandExtras(plan.fields)) &&
		command.args.length === args.length &&
		command.args.every(({ name }, position) => name === args[position]) &&
		plan.inputs.every(({ kind, name }) => kind === "arg" || Object.hasOwn(command.flags, name))
	);
}
