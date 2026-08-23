/** Any value representable in a JSON document. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

/** Narrow a JSON document root to an object (not array/scalar/null). */
export function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
