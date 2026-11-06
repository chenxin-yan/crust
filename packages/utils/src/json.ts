/** Any value representable in a JSON document. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

/** Preserve a type when all of its properties are recursively JSON-compatible. */
export type JsonCompatible<T> = T extends JsonValue
	? T
	: T extends (...arguments_: never[]) => void
		? never
		: T extends readonly unknown[]
			? { [K in keyof T]: JsonCompatible<T[K]> }
			: T extends object
				? { [K in keyof T]: JsonCompatible<T[K]> }
				: never;

/** Narrow a JSON document root to an object (not array/scalar/null). */
export function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

/**
 * Detached copy of a value `JSON.stringify` round-trips without loss, reading each
 * property once so getters cannot change between validation and serialization.
 * Accepts finite numbers, strings, booleans, `null`, dense plain arrays of such,
 * and plain or null-prototype objects whose own keys are all enumerable strings
 * (copied as plain objects; `__proto__` stays an own key). Throws on `undefined`,
 * functions (including `toJSON` hooks, which never run), symbols, BigInt, `NaN`,
 * class instances (`Date`, `Map`, `URL`, Array subclasses, …), array holes,
 * non-index array keys, symbol or non-enumerable keys, and cycles. `-0` is kept
 * because `JSON.parse` yields it for client input; results reject it when
 * serialized. `copies` maps each object to its finished copy, or `undefined`
 * while it is being copied: an object referenced twice reuses one capture, and
 * reaching an in-progress object is a cycle.
 */
export function parseJsonValue(
	value: unknown,
	copies: Map<object, JsonValue | undefined> = new Map(),
): JsonValue {
	if (isJsonPrimitive(value)) return value;
	if (!isObject(value)) throw new TypeError("Not JSON data");
	if (copies.has(value)) {
		const copy = copies.get(value);
		if (copy === undefined) throw new TypeError("Cycle");
		return copy;
	}
	if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("Symbol key");
	const proto = Object.getPrototypeOf(value);
	const names = Object.getOwnPropertyNames(value);
	if (Array.isArray(value)) {
		// Holes serialize as `null` and named keys are dropped: require exactly the indices plus `length`.
		if (proto !== Array.prototype || names.length !== value.length + 1) {
			throw new TypeError("Not a dense plain array");
		}
		if (!names.every((name, index) => name === "length" || name === String(index))) {
			throw new TypeError("Array hole");
		}
	} else {
		if (proto !== Object.prototype && proto !== null) throw new TypeError("Not a plain object");
		// Non-enumerable keys are dropped.
		if (!names.every((name) => Object.prototype.propertyIsEnumerable.call(value, name))) {
			throw new TypeError("Non-enumerable key");
		}
	}
	copies.set(value, undefined);
	const copy = Array.isArray(value)
		? Array.from({ length: value.length }, (_, index) => parseJsonValue(value[index], copies))
		: // Capture the validated names even if a getter hides a later property.
			// `fromEntries` defines own properties, so a `__proto__` key cannot set the prototype.
			Object.fromEntries(
				// oxlint-disable-next-line eslint/no-restricted-properties -- this JSON boundary recursively validates each dynamic property before accepting it.
				names.map((key) => [key, parseJsonValue(Reflect.get(value, key), copies)] as const),
			);
	if (
		(Array.isArray(value) && value.length !== copy.length) ||
		Reflect.ownKeys(value).some((key) => !Object.hasOwn(copy, key))
	) {
		throw new TypeError("Properties added during capture");
	}
	copies.set(value, copy);
	return copy;
}
