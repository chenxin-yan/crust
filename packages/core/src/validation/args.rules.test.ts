import { describe, expect, it } from "bun:test";

import { CrustError } from "../errors.ts";
import type { ArgDef } from "../types.ts";
import { schemaExclusivity, variadicPosition } from "./args.rules.ts";

function thrownBy(run: () => void): CrustError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(CrustError);
		return error as CrustError;
	}
	throw new Error("Expected validation to throw");
}

describe("argument runtime validation", () => {
	it("rejects combining an argument schema with a parser type", () => {
		const error = thrownBy(() =>
			schemaExclusivity("arg", "input", {
				schema: {},
				type: "string",
			} as unknown as ArgDef),
		);

		expect(error.toJSON()).toEqual({
			code: "DEFINITION",
			message:
				'arg "input" mixes core option "type" with a schema — schema args receive the raw string token',
			details: { subject: "arg", name: "input", reason: "schema-exclusive" },
		});
	});

	it("rejects a variadic argument before the final position", () => {
		const error = thrownBy(() => variadicPosition({ name: "files", variadic: true }, 0, 2));

		expect(error.toJSON()).toEqual({
			code: "DEFINITION",
			message:
				'Argument "files" is variadic, but only the last positional argument can be variadic',
			details: { subject: "arg", name: "files", reason: "variadic-position" },
		});
	});
});
