// Read-only traversal and local `$ref` resolution shared by `api --list` / `--spec` and the
// operation model; the `$refs` print format stays in api-command.ts.
import type { OpenApiSpec } from "./api-command.ts";

export const METHODS = [
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
] as const;

/**
 * The value a local `$ref`'s JSON Pointer fragment (`#/...`, URI-encoded or not) points to
 * in `spec`, or `undefined`, also for other fragments such as `#anchor`.
 */
export function refTarget(spec: OpenApiSpec, ref: string): unknown {
	const keys = pointerKeys(ref);
	if (keys === undefined) return undefined;
	let target: unknown = spec;
	for (const key of keys) {
		target =
			typeof target === "object" && target !== null && Object.hasOwn(target, key)
				? (target as Record<string, unknown>)[key]
				: undefined;
	}
	return target;
}

/** The keys a local `$ref`'s JSON Pointer fragment walks from the document root, or `undefined` for another fragment. */
export function pointerKeys(ref: string): string[] | undefined {
	let pointer: string;
	try {
		pointer = decodeURIComponent(ref.slice(1));
	} catch {
		return undefined;
	}
	if (pointer !== "" && !pointer.startsWith("/")) return undefined;
	return pointer
		.split("/")
		.slice(1)
		.map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** A Path Item with its own local `$ref`s (e.g. to `components.pathItems`) followed; sibling keys win. */
export function pathItem(
	spec: OpenApiSpec,
	item: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	let current: Record<string, unknown> = item;
	const seen = new Set<string>();
	for (
		let ref = current.$ref;
		typeof ref === "string" && ref.startsWith("#") && !seen.has(ref);
		ref = current.$ref
	) {
		seen.add(ref);
		const target = refTarget(spec, ref);
		if (typeof target !== "object" || target === null || Array.isArray(target)) break;
		const { $ref: _ref, ...siblings } = current;
		current = { ...target, ...siblings };
	}
	return current;
}

export interface RawOperation {
	readonly method: (typeof METHODS)[number];
	readonly path: string;
	readonly operation: object;
	/** The path item's shared `parameters`. */
	readonly shared: unknown;
}

export function rawOperations(spec: OpenApiSpec): RawOperation[] {
	return Object.entries(spec.paths ?? {}).flatMap(([path, item]) => {
		if (!path.startsWith("/") || typeof item !== "object" || item === null) return [];
		const resolved = pathItem(spec, item as Readonly<Record<string, unknown>>);
		return METHODS.flatMap((method) => {
			const operation = resolved[method];
			return typeof operation === "object" && operation !== null
				? [{ method, path, operation, shared: resolved.parameters }]
				: [];
		});
	});
}

export function isLocalRef(ref: unknown): ref is string {
	return typeof ref === "string" && ref.startsWith("#");
}

/** `value` with its local `$ref` chain followed, stopping at a cycle or a dangling `$ref`. */
export function deref(spec: OpenApiSpec, value: unknown): unknown {
	const seen = new Set<string>();
	for (;;) {
		const ref =
			typeof value === "object" && value !== null ? (value as { $ref?: unknown }).$ref : undefined;
		if (!isLocalRef(ref) || seen.has(ref)) return value;
		seen.add(ref);
		const target = refTarget(spec, ref);
		if (target === undefined) return value;
		value = target;
	}
}

/** The path item's `parameters`, minus those the operation redefines (same `name` and `in`), then the operation's. */
export function mergeParameters(spec: OpenApiSpec, shared: unknown, own: unknown): unknown[] {
	const list = (parameters: unknown): unknown[] => (Array.isArray(parameters) ? parameters : []);
	const key = (parameter: unknown): string | undefined => {
		const { name, in: location } = (deref(spec, parameter) ?? {}) as {
			name?: unknown;
			in?: unknown;
		};
		return typeof name === "string" && typeof location === "string"
			? JSON.stringify([location, name])
			: undefined;
	};
	const redefined = new Set(list(own).map(key));
	return [
		...list(shared).filter((parameter) => {
			const id = key(parameter);
			return id === undefined || !redefined.has(id);
		}),
		...list(own),
	];
}
