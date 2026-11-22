import type { CommandInputPropertySchema } from "./command-input.ts";

declare const property: CommandInputPropertySchema;

// Compile-time regression checks; intentionally never invoked.
// a json flag publishes its schema's JSON Schema, so `type` and `enum` hold any JSON Schema value
function _typecheckPropertySchemaHoldsAnyJsonSchemaType() {
	if (property.type === "object" || property.type === "null" || property.type === "integer") return;
	const types: readonly string[] | undefined =
		typeof property.type === "string" ? [property.type] : property.type;
	const values: readonly unknown[] | undefined = property.enum;
	void [types, values];
}
