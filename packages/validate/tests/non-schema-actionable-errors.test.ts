// Regression test: parse helper must throw an actionable
// `CrustError("DEFINITION")` when handed a non-Standard-Schema value,
// instead of letting raw `TypeError: Cannot read properties of undefined
// (reading 'validate')` escape from internal `~standard.validate` access.
//
// `field()` lives in `@crustjs/store` as of 0.3.0; its equivalent
// regression test lives in `packages/store/src/field.test.ts`.

import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import { parseValue } from "../src/index.ts";

const NOT_A_SCHEMA: unknown = { foo: "bar" };

async function expectAsyncDefinitionError(
	thunk: () => Promise<unknown>,
	matcher: RegExp,
): Promise<void> {
	let caught: unknown;
	try {
		await thunk();
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(CrustError);
	expect((caught as CrustError).code).toBe("DEFINITION");
	expect((caught as CrustError).message).toMatch(matcher);
}

describe("parse helper rejects non-Standard-Schema input at construction", () => {
	it("parseValue throws DEFINITION for non-schema", async () => {
		await expectAsyncDefinitionError(
			() => parseValue(NOT_A_SCHEMA as never, "x" as never),
			/Standard Schema v1/i,
		);
	});
});
