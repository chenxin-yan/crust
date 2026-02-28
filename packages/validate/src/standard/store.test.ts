import { describe, expect, it } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { field, fieldSync } from "./store.ts";
import type { StandardSchema } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — minimal Standard Schema implementations
// ────────────────────────────────────────────────────────────────────────────

/** Create a sync schema that always succeeds with the input value. */
function passthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T }),
		},
	};
}

/** Create a sync schema that always fails with the given issues. */
function failingSchema(
	issues: StandardSchemaV1.Issue[],
): StandardSchema<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ issues }),
		},
	};
}

/** Create an async schema that succeeds after a tick. */
function asyncPassthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async (value) => ({ value: value as T }),
		},
	};
}

/** Create an async schema that fails after a tick. */
function asyncFailingSchema(
	issues: StandardSchemaV1.Issue[],
): StandardSchema<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async () => ({ issues }),
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// field (async)
// ────────────────────────────────────────────────────────────────────────────

describe("field", () => {
	describe("valid values", () => {
		it("does not throw for a passthrough schema", async () => {
			const validate = field(passthroughSchema());
			await expect(validate("hello")).resolves.toBeUndefined();
		});

		it("does not throw for async passthrough schema", async () => {
			const validate = field(asyncPassthroughSchema());
			await expect(validate(42)).resolves.toBeUndefined();
		});

		it("does not throw for various value types", async () => {
			const validate = field(passthroughSchema());
			await expect(validate(true)).resolves.toBeUndefined();
			await expect(validate(0)).resolves.toBeUndefined();
			await expect(validate("")).resolves.toBeUndefined();
		});
	});

	describe("invalid values", () => {
		it("throws Error with message from a single issue", async () => {
			const validate = field(
				failingSchema([{ message: "Expected string", path: [] }]),
			);
			await expect(validate(123)).rejects.toThrow("Expected string");
		});

		it("throws Error with path-prefixed message for nested paths", async () => {
			const validate = field(
				failingSchema([{ message: "Too short", path: ["host"] }]),
			);
			await expect(validate({})).rejects.toThrow("host: Too short");
		});

		it("joins multiple issues with semicolons", async () => {
			const validate = field(
				failingSchema([
					{ message: "Required", path: ["a"] },
					{ message: "Invalid", path: ["b"] },
				]),
			);
			try {
				await validate({});
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(Error);
				expect((err as Error).message).toBe("a: Required; b: Invalid");
			}
		});

		it("handles root-level issues (empty path)", async () => {
			const validate = field(failingSchema([{ message: "Invalid value" }]));
			await expect(validate("bad")).rejects.toThrow("Invalid value");
		});

		it("works with async failing schemas", async () => {
			const validate = field(
				asyncFailingSchema([{ message: "Expected number", path: [] }]),
			);
			await expect(validate("abc")).rejects.toThrow("Expected number");
		});

		it("normalizes PathSegment object paths", async () => {
			const validate = field(
				failingSchema([
					{ message: "Required", path: [{ key: "config" }, { key: "name" }] },
				]),
			);
			await expect(validate({})).rejects.toThrow("config.name: Required");
		});

		it("normalizes array index paths to bracket notation", async () => {
			const validate = field(
				failingSchema([{ message: "Invalid", path: ["items", 0] }]),
			);
			await expect(validate({})).rejects.toThrow("items[0]: Invalid");
		});
	});

	describe("edge cases", () => {
		it("handles null input", async () => {
			const validate = field(failingSchema([{ message: "Expected object" }]));
			await expect(validate(null)).rejects.toThrow("Expected object");
		});

		it("handles undefined input", async () => {
			const validate = field(failingSchema([{ message: "Expected object" }]));
			await expect(validate(undefined)).rejects.toThrow("Expected object");
		});

		it("returns the same validator function for successive calls", async () => {
			const schema = passthroughSchema();
			const validate = field(schema);

			await expect(validate("a")).resolves.toBeUndefined();
			await expect(validate("b")).resolves.toBeUndefined();
		});

		it("handles schema with empty issues array — still throws", async () => {
			const validate = field(failingSchema([]));
			// Empty issues array means failure, but no messages — throws with empty message
			await expect(validate({})).rejects.toThrow();
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// fieldSync
// ────────────────────────────────────────────────────────────────────────────

describe("fieldSync", () => {
	describe("valid values", () => {
		it("does not throw for a passthrough schema", () => {
			const validate = fieldSync(passthroughSchema());
			expect(validate("hello")).toBeUndefined();
		});

		it("does not throw for various value types", () => {
			const validate = fieldSync(passthroughSchema());
			expect(validate(42)).toBeUndefined();
			expect(validate(true)).toBeUndefined();
			expect(validate("")).toBeUndefined();
		});
	});

	describe("invalid values", () => {
		it("throws Error with message from a single issue", () => {
			const validate = fieldSync(
				failingSchema([{ message: "Expected string", path: ["theme"] }]),
			);
			expect(() => validate(123)).toThrow("theme: Expected string");
		});

		it("joins multiple issues with semicolons", () => {
			const validate = fieldSync(
				failingSchema([
					{ message: "Bad host", path: ["db", "host"] },
					{ message: "Bad port", path: ["ports", 0] },
				]),
			);
			expect(() => validate({})).toThrow(
				"db.host: Bad host; ports[0]: Bad port",
			);
		});

		it("handles root-level issues", () => {
			const validate = fieldSync(failingSchema([{ message: "Invalid" }]));
			expect(() => validate({})).toThrow("Invalid");
		});
	});

	describe("async schema rejection", () => {
		it("throws TypeError when schema returns a Promise", () => {
			const validate = fieldSync(asyncPassthroughSchema());

			expect(() => validate({})).toThrow(TypeError);
			expect(() => validate({})).toThrow(
				/Schema returned a Promise from validate/,
			);
		});
	});

	describe("edge cases", () => {
		it("handles successive calls with different inputs", () => {
			const validate = fieldSync(passthroughSchema());

			expect(validate("x")).toBeUndefined();
			expect(validate("y")).toBeUndefined();
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Field validate contract compatibility — structural match with @crustjs/store
// ────────────────────────────────────────────────────────────────────────────

describe("field validate contract compatibility", () => {
	it("async validator returns a function with (value) => Promise<void> signature", async () => {
		const validate = field(passthroughSchema());

		expect(typeof validate).toBe("function");
		const result = validate("hello");
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
	});

	it("sync validator returns a function with (value) => void signature", () => {
		const validate = fieldSync(passthroughSchema());

		expect(typeof validate).toBe("function");
		const result = validate("hello");
		// Sync — not a Promise
		expect(result).toBeUndefined();
	});

	it("async validator throws Error (not result object) on failure", async () => {
		const validate = field(
			failingSchema([{ message: "Bad", path: ["theme"] }]),
		);

		try {
			await validate({});
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toBe("theme: Bad");
		}
	});

	it("sync validator throws Error (not result object) on failure", () => {
		const validate = fieldSync(
			failingSchema([{ message: "Bad", path: ["theme"] }]),
		);

		try {
			validate({});
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toBe("theme: Bad");
		}
	});

	it("returned function is assignable to (value: V) => void | Promise<void>", async () => {
		// This test verifies structural compatibility with FieldDef.validate
		const asyncValidate: (value: unknown) => void | Promise<void> = field(
			passthroughSchema(),
		);
		const syncValidate: (value: unknown) => void | Promise<void> = fieldSync(
			passthroughSchema(),
		);

		await asyncValidate("test");
		syncValidate("test");
	});
});
