import { describe, expect, it } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { promptValidator } from "./prompt.ts";
import type { StandardSchema } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — minimal Standard Schema implementations
// ────────────────────────────────────────────────────────────────────────────

/** Create a sync schema that always succeeds. */
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

/** Create a sync schema that transforms the value. */
function transformSchema<T>(output: T): StandardSchema<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ value: output }),
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// promptValidator — basic behavior
// ────────────────────────────────────────────────────────────────────────────

describe("promptValidator", () => {
	it("returns a function", () => {
		const validate = promptValidator(passthroughSchema());
		expect(typeof validate).toBe("function");
	});

	it("returns true for valid sync schema", async () => {
		const validate = promptValidator(passthroughSchema<string>());
		const result = await validate("hello");
		expect(result).toBe(true);
	});

	it("returns true for valid async schema", async () => {
		const validate = promptValidator(asyncPassthroughSchema<string>());
		const result = await validate("hello");
		expect(result).toBe(true);
	});

	it("returns true for transforming schema", async () => {
		const validate = promptValidator(transformSchema(42));
		const result = await validate("any input");
		expect(result).toBe(true);
	});

	it("returns error string for invalid sync schema", async () => {
		const validate = promptValidator(
			failingSchema([{ message: "Must be a valid email" }]),
		);
		const result = await validate("bad");
		expect(result).toBe("Must be a valid email");
	});

	it("returns error string for invalid async schema", async () => {
		const validate = promptValidator(
			asyncFailingSchema([{ message: "Too short" }]),
		);
		const result = await validate("x");
		expect(result).toBe("Too short");
	});

	// ────────────────────────────────────────────────────────────────────────
	// "first" strategy (default) — single issue
	// ────────────────────────────────────────────────────────────────────────

	describe('errorStrategy: "first" (default)', () => {
		it("returns first issue message for root-level error", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Invalid input" }]),
			);
			const result = await validate("bad");
			expect(result).toBe("Invalid input");
		});

		it("includes path in error message when present", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Required", path: ["name"] }]),
			);
			const result = await validate("bad");
			expect(result).toBe("name: Required");
		});

		it("returns only first issue when multiple issues exist", async () => {
			const validate = promptValidator(
				failingSchema([
					{ message: "Too short", path: ["name"] },
					{ message: "Required", path: ["email"] },
					{ message: "Must be positive" },
				]),
			);
			const result = await validate("bad");
			expect(result).toBe("name: Too short");
		});

		it("handles nested path in first issue", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Invalid", path: ["config", "port"] }]),
			);
			const result = await validate("bad");
			expect(result).toBe("config.port: Invalid");
		});

		it("handles array index path in first issue", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Invalid item", path: ["items", 0] }]),
			);
			const result = await validate("bad");
			expect(result).toBe("items[0]: Invalid item");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// "all" strategy — multi-issue bullet list
	// ────────────────────────────────────────────────────────────────────────

	describe('errorStrategy: "all"', () => {
		it("renders single root-level error as bullet list", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Invalid input" }]),
				{ errorStrategy: "all" },
			);
			const result = await validate("bad");
			expect(result).toBe("Validation failed\n  - Invalid input");
		});

		it("renders single error with path as bullet list", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Required", path: ["name"] }]),
				{ errorStrategy: "all" },
			);
			const result = await validate("bad");
			expect(result).toBe("Validation failed\n  - name: Required");
		});

		it("renders multiple issues as bullet list", async () => {
			const validate = promptValidator(
				failingSchema([
					{ message: "Too short", path: ["name"] },
					{ message: "Required", path: ["email"] },
				]),
				{ errorStrategy: "all" },
			);
			const result = await validate("bad");
			expect(result).toBe(
				"Validation failed\n  - name: Too short\n  - email: Required",
			);
		});

		it("renders mixed root and path issues as bullet list", async () => {
			const validate = promptValidator(
				failingSchema([
					{ message: "Too short", path: ["name"] },
					{ message: "Root error" },
				]),
				{ errorStrategy: "all" },
			);
			const result = await validate("bad");
			expect(result).toBe(
				"Validation failed\n  - name: Too short\n  - Root error",
			);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Async handling
	// ────────────────────────────────────────────────────────────────────────

	describe("async behavior", () => {
		it("always returns a promise", () => {
			const validate = promptValidator(passthroughSchema<string>());
			const result = validate("test");
			expect(result).toBeInstanceOf(Promise);
		});

		it("handles async schema success", async () => {
			const validate = promptValidator(asyncPassthroughSchema<string>());
			expect(await validate("valid")).toBe(true);
		});

		it("handles async schema failure", async () => {
			const validate = promptValidator(
				asyncFailingSchema([{ message: "Async error" }]),
			);
			expect(await validate("bad")).toBe("Async error");
		});

		it("handles async schema failure with all strategy", async () => {
			const validate = promptValidator(
				asyncFailingSchema([{ message: "Error 1" }, { message: "Error 2" }]),
				{ errorStrategy: "all" },
			);
			const result = await validate("bad");
			expect(result).toBe("Validation failed\n  - Error 1\n  - Error 2");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles empty issues array gracefully", async () => {
			// Edge case: schema reports failure but no issues
			const schema: StandardSchema<unknown, never> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: () => ({ issues: [] }),
				},
			};
			const validate = promptValidator(schema);
			const result = await validate("bad");
			// Empty issues should still produce an error string
			expect(result).toBe("Validation failed");
		});

		it("handles empty issues array with all strategy", async () => {
			const schema: StandardSchema<unknown, never> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: () => ({ issues: [] }),
				},
			};
			const validate = promptValidator(schema, { errorStrategy: "all" });
			const result = await validate("bad");
			expect(result).toBe("Validation failed");
		});

		it("validates different values on successive calls", async () => {
			let callCount = 0;
			const schema: StandardSchema<string, string> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: (value) => {
						callCount++;
						if (value === "good") return { value: value as string };
						return { issues: [{ message: `Invalid: ${value}` }] };
					},
				},
			};
			const validate = promptValidator(schema);

			expect(await validate("bad")).toBe("Invalid: bad");
			expect(await validate("good")).toBe(true);
			expect(await validate("also bad")).toBe("Invalid: also bad");
			expect(callCount).toBe(3);
		});

		it("handles PathSegment objects in issue paths", async () => {
			const validate = promptValidator(
				failingSchema([
					{ message: "Bad", path: [{ key: "items" }, { key: 0 }] },
				]),
			);
			const result = await validate("bad");
			expect(result).toBe("items[0]: Bad");
		});

		it("handles undefined and null values", async () => {
			const validate = promptValidator(
				failingSchema([{ message: "Required" }]),
			);
			expect(await validate(undefined)).toBe("Required");
			expect(await validate(null)).toBe("Required");
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// ValidateFn contract compatibility
	// ────────────────────────────────────────────────────────────────────────

	describe("ValidateFn contract compatibility", () => {
		it("return type is true | string (via promise)", async () => {
			const validate = promptValidator(passthroughSchema<string>());
			const successResult = await validate("valid");
			expect(successResult).toBe(true);
			expect(typeof successResult).toBe("boolean");

			const failValidate = promptValidator(failingSchema([{ message: "err" }]));
			const failResult = await failValidate("bad");
			expect(typeof failResult).toBe("string");
		});

		it("can be used as validate option shape", async () => {
			// Simulate prompt usage: validate is called with the prompt value
			const schema = failingSchema([{ message: "Must contain @" }]);
			const options = {
				message: "Enter email",
				validate: promptValidator(schema),
			};

			// Simulate prompt calling validate
			const result = await options.validate("no-at-sign");
			expect(result).toBe("Must contain @");
		});
	});
});
