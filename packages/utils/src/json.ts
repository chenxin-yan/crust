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
