// Regression test: prompt and store helpers must throw actionable
// `CrustError("DEFINITION")` errors when handed a non-Standard-Schema
// value, instead of letting raw `TypeError: Cannot read properties of
// undefined (reading 'validate')` escape from internal `~standard.validate`
// access.
//
// Verifies should-fix #14.

import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import {
	field,
	fieldSync,
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "../src/index.ts";

const NOT_A_SCHEMA: unknown = { foo: "bar" };

function expectDefinitionError(
	thunk: () => unknown | Promise<unknown>,
	matcher: RegExp,
): void {
	try {
		const out = thunk();
		if (out instanceof Promise) {
			throw new Error("expected synchronous throw");
		}
		throw new Error("expected throw");
	} catch (err) {
		expect(err).toBeInstanceOf(CrustError);
		expect((err as CrustError).code).toBe("DEFINITION");
		expect((err as CrustError).message).toMatch(matcher);
	}
}

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

describe("prompt helpers reject non-Standard-Schema input at construction", () => {
	it("promptValidator throws DEFINITION for non-schema", () => {
		expectDefinitionError(
			() => promptValidator(NOT_A_SCHEMA as never),
			/Standard Schema v1/i,
		);
	});

	it("parsePromptValue throws DEFINITION for non-schema", async () => {
		await expectAsyncDefinitionError(
			() => parsePromptValue(NOT_A_SCHEMA as never, "x" as never),
			/Standard Schema v1/i,
		);
	});

	it("parsePromptValueSync throws DEFINITION for non-schema", () => {
		expectDefinitionError(
			() => parsePromptValueSync(NOT_A_SCHEMA as never, "x" as never),
			/Standard Schema v1/i,
		);
	});
});

describe("store field helpers reject non-Standard-Schema input at construction", () => {
	it("field() throws DEFINITION for non-schema", () => {
		expectDefinitionError(
			() => field(NOT_A_SCHEMA as never),
			/Standard Schema v1/i,
		);
	});

	it("fieldSync() throws DEFINITION for non-schema", () => {
		expectDefinitionError(
			() => fieldSync(NOT_A_SCHEMA as never),
			/Standard Schema v1/i,
		);
	});
});
