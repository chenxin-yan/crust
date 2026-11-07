import type { Equal, Expect } from "../../tests/helpers.ts";
import type { CommandInputPropertySchema } from "./command-input.ts";

// Schema-backed definitions pass their JSON Schema keywords through, not only core's.
type _Format = Expect<Equal<CommandInputPropertySchema["format"], string | undefined>>;
type _Enum = Expect<
	Equal<CommandInputPropertySchema["enum"], readonly (string | boolean)[] | undefined>
>;

function _compare(schema: CommandInputPropertySchema) {
	return schema.format === "email" || schema.enum?.includes(true);
}
