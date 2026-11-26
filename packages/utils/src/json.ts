/** Any value representable in a JSON document. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

/**
 * Preserve a type when all of its properties are recursively JSON-compatible.
 * An optional property may hold `undefined`, which serializes as an absent key.
 */
export type JsonCompatible<T> = T extends JsonValue
	? T
	: T extends (...arguments_: never[]) => void
		? never
		: T extends readonly unknown[]
			? { [K in keyof T]: JsonCompatible<T[K]> }
			: T extends object
				? {
						[K in keyof T]: JsonCompatible<T[K]> | ({} extends Pick<T, K> ? undefined : never);
					}
				: never;

/**
 * A Crust error's own JSON details: the `json()` Extension prints an error that is not a
 * `CrustError` as `{ message }`, plus `details` when the error has this property.
 * Opt-in, so no field of another library's error, which may hold a credential, is printed.
 */
export const jsonErrorDetails: unique symbol = Symbol.for("crustjs.json.errorDetails");

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

/** `path` extended by an object key, as JavaScript would write it: `.name` or `["a b"]`. */
function keyPath(path: string, key: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Detached copy of a value `JSON.stringify` round-trips without loss, reading each
 * property once so getters cannot change between validation and serialization.
 * Accepts finite numbers, strings, booleans, `null`, dense plain arrays of such,
 * and plain or null-prototype objects whose own keys are all enumerable strings
 * (copied as plain objects; `__proto__` stays an own key). An object property holding
 * `undefined` is left out of the copy, as `JSON.stringify` leaves it out. Throws a
 * `TypeError` naming where the value sits (`items[3].createdAt: Not a plain object`) on
 * `undefined` elsewhere, functions (including `toJSON` hooks, which never run), symbols,
 * BigInt, `NaN`, class instances (`Date`, `Map`, `URL`, Array subclasses, …), array
 * holes, non-index array keys, symbol or non-enumerable keys, and cycles. `-0` is kept
 * because `JSON.parse` yields it for client input; results reject it when serialized.
 */
export function parseJsonValue(value: unknown): JsonValue {
	return copyJsonValue(value, new Map(), "");
}

/**
 * `copies` maps each object to its finished copy, or `undefined` while it is being
 * copied: an object referenced twice reuses one capture, and reaching an in-progress
 * object is a cycle. `path` is where `value` sits, `""` for the root.
 */
function copyJsonValue(
	value: unknown,
	copies: Map<object, JsonValue | undefined>,
	path: string,
): JsonValue {
	const fail = (reason: string) =>
		new TypeError(path === "" ? reason : `${path.replace(/^\./, "")}: ${reason}`);
	if (isJsonPrimitive(value)) return value;
	if (!isObject(value)) throw fail("Not JSON data");
	if (copies.has(value)) {
		const copy = copies.get(value);
		if (copy === undefined) throw fail("Cycle");
		return copy;
	}
	if (Object.getOwnPropertySymbols(value).length > 0) throw fail("Symbol key");
	const proto = Object.getPrototypeOf(value);
	const names = Object.getOwnPropertyNames(value);
	if (Array.isArray(value)) {
		// Holes serialize as `null` and named keys are dropped: require exactly the indices plus `length`.
		if (proto !== Array.prototype || names.length !== value.length + 1) {
			throw fail("Not a dense plain array");
		}
		if (!names.every((name, index) => name === "length" || name === String(index))) {
			throw fail("Array hole");
		}
	} else {
		if (proto !== Object.prototype && proto !== null) throw fail("Not a plain object");
		// Non-enumerable keys are dropped.
		if (!names.every((name) => Object.prototype.propertyIsEnumerable.call(value, name))) {
			throw fail("Non-enumerable key");
		}
	}
	copies.set(value, undefined);
	const copy = Array.isArray(value)
		? Array.from({ length: value.length }, (_, index) =>
				copyJsonValue(value[index], copies, `${path}[${index}]`),
			)
		: // Capture the validated names even if a getter hides a later property.
			// `fromEntries` defines own properties, so a `__proto__` key cannot set the prototype.
			Object.fromEntries(
				names.map((key) => {
					// oxlint-disable-next-line eslint/no-restricted-properties -- this JSON boundary recursively validates each dynamic property before accepting it.
					const item: unknown = Reflect.get(value, key);
					return [key, item === undefined ? item : copyJsonValue(item, copies, keyPath(path, key))];
				}),
			);
	if (
		(Array.isArray(value) && value.length !== copy.length) ||
		Reflect.ownKeys(value).some((key) => !Object.hasOwn(copy, key))
	) {
		throw fail("Properties added during capture");
	}
	const result: JsonValue = Array.isArray(copy)
		? copy
		: Object.fromEntries(
				Object.entries(copy).filter(
					(entry): entry is [string, JsonValue] => entry[1] !== undefined,
				),
			);
	copies.set(value, result);
	return result;
}
