import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
} from "./prompt.ts";
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

/** Create an async schema that transforms the value. */
function asyncTransformSchema<T>(output: T): StandardSchema<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async () => ({ value: output }),
		},
	};
}

/** Create a sync schema that conditionally validates and transforms. */
function coerceNumberSchema(): StandardSchema<string, number> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => {
				const num = Number(value);
				if (Number.isNaN(num)) {
					return { issues: [{ message: "Expected a number" }] };
				}
				return { value: num };
			},
		},
	};
}

/** Create a sync schema with default fallback. */
function defaultSchema<T>(defaultValue: T): StandardSchema<T | undefined, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({
				value: (value === undefined ? defaultValue : value) as T,
			}),
		},
	};
}

/** Create a sync schema that makes a value optional. */
function optionalSchema<T>(): StandardSchema<T | undefined, T | undefined> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T | undefined }),
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

// ────────────────────────────────────────────────────────────────────────────
// parsePromptValue — async typed parsing helper
// ────────────────────────────────────────────────────────────────────────────

describe("parsePromptValue", () => {
	it("returns the passthrough value for a valid input", async () => {
		const result = await parsePromptValue(passthroughSchema<string>(), "hello");
		expect(result).toBe("hello");
	});

	it("returns transformed output from a sync schema", async () => {
		const result = await parsePromptValue(transformSchema(42), "any");
		expect(result).toBe(42);
	});

	it("returns transformed output from an async schema", async () => {
		const result = await parsePromptValue(asyncTransformSchema(99), "any");
		expect(result).toBe(99);
	});

	it("returns coerced number from a string input", async () => {
		const result = await parsePromptValue(coerceNumberSchema(), "8080");
		expect(result).toBe(8080);
	});

	it("throws CrustError(VALIDATION) on invalid input", async () => {
		try {
			await parsePromptValue(
				failingSchema([{ message: "Must be a valid email" }]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Prompt validation failed");
			expect(crustErr.message).toContain("Must be a valid email");
		}
	});

	it("throws CrustError with structured issues on failure", async () => {
		try {
			await parsePromptValue(
				failingSchema([
					{ message: "Too short", path: ["name"] },
					{ message: "Required", path: ["email"] },
				]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.details).toBeDefined();
			expect(crustErr.details?.issues).toHaveLength(2);
			expect(crustErr.details?.issues[0]).toEqual({
				message: "Too short",
				path: "name",
			});
			expect(crustErr.details?.issues[1]).toEqual({
				message: "Required",
				path: "email",
			});
		}
	});

	it("always returns a promise", () => {
		const result = parsePromptValue(passthroughSchema<string>(), "test");
		expect(result).toBeInstanceOf(Promise);
	});

	it("handles async schema success", async () => {
		const result = await parsePromptValue(
			asyncPassthroughSchema<string>(),
			"valid",
		);
		expect(result).toBe("valid");
	});

	it("handles async schema failure", async () => {
		try {
			await parsePromptValue(
				asyncFailingSchema([{ message: "Async error" }]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Async error");
		}
	});

	// ── Schema types: optional, default, transform ──────────────────────

	describe("schema type scenarios", () => {
		it("handles default values for undefined input", async () => {
			const result = await parsePromptValue(defaultSchema(3000), undefined);
			expect(result).toBe(3000);
		});

		it("passes through defined values with default schema", async () => {
			const result = await parsePromptValue(defaultSchema(3000), 8080);
			expect(result).toBe(8080);
		});

		it("handles optional schema with defined value", async () => {
			const result = await parsePromptValue(optionalSchema<string>(), "hello");
			expect(result).toBe("hello");
		});

		it("handles optional schema with undefined value", async () => {
			const result = await parsePromptValue(
				optionalSchema<string>(),
				undefined,
			);
			expect(result).toBeUndefined();
		});

		it("handles object transform schema", async () => {
			const schema = transformSchema({ port: 8080, host: "localhost" });
			const result = await parsePromptValue(schema, "config string");
			expect(result).toEqual({ port: 8080, host: "localhost" });
		});

		it("handles array transform schema", async () => {
			const schema = transformSchema(["a", "b", "c"]);
			const result = await parsePromptValue(schema, "input");
			expect(result).toEqual(["a", "b", "c"]);
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("throws on empty issues array with fallback message", async () => {
			const schema: StandardSchema<unknown, never> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: () => ({ issues: [] }),
				},
			};
			try {
				await parsePromptValue(schema, "bad");
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError<"VALIDATION">;
				expect(crustErr.code).toBe("VALIDATION");
				expect(crustErr.message).toBe("Prompt validation failed");
			}
		});

		it("handles null input", async () => {
			const result = await parsePromptValue(passthroughSchema<null>(), null);
			expect(result).toBeNull();
		});

		it("handles boolean transform", async () => {
			const result = await parsePromptValue(transformSchema(true), "yes");
			expect(result).toBe(true);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// parsePromptValueSync — sync typed parsing helper
// ────────────────────────────────────────────────────────────────────────────

describe("parsePromptValueSync", () => {
	it("returns the passthrough value for a valid input", () => {
		const result = parsePromptValueSync(passthroughSchema<string>(), "hello");
		expect(result).toBe("hello");
	});

	it("returns transformed output from a sync schema", () => {
		const result = parsePromptValueSync(transformSchema(42), "any");
		expect(result).toBe(42);
	});

	it("returns coerced number from a string input", () => {
		const result = parsePromptValueSync(coerceNumberSchema(), "8080");
		expect(result).toBe(8080);
	});

	it("throws CrustError(VALIDATION) on invalid input", () => {
		try {
			parsePromptValueSync(
				failingSchema([{ message: "Must be a valid email" }]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Prompt validation failed");
			expect(crustErr.message).toContain("Must be a valid email");
		}
	});

	it("throws CrustError with structured issues on failure", () => {
		try {
			parsePromptValueSync(
				failingSchema([
					{ message: "Too short", path: ["name"] },
					{ message: "Required", path: ["email"] },
				]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.details).toBeDefined();
			expect(crustErr.details?.issues).toHaveLength(2);
			expect(crustErr.details?.issues[0]).toEqual({
				message: "Too short",
				path: "name",
			});
			expect(crustErr.details?.issues[1]).toEqual({
				message: "Required",
				path: "email",
			});
		}
	});

	it("returns synchronously (not a promise)", () => {
		const result = parsePromptValueSync(passthroughSchema<string>(), "test");
		expect(result).not.toBeInstanceOf(Promise);
		expect(result).toBe("test");
	});

	it("throws TypeError for async schemas", () => {
		expect(() => {
			parsePromptValueSync(asyncPassthroughSchema<string>(), "test");
		}).toThrow(TypeError);
	});

	it("throws TypeError with helpful message for async schemas", () => {
		try {
			parsePromptValueSync(asyncPassthroughSchema<string>(), "test");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(TypeError);
			expect((err as TypeError).message).toContain("Use validateStandard()");
		}
	});

	// ── Schema type scenarios ───────────────────────────────────────────

	describe("schema type scenarios", () => {
		it("handles default values for undefined input", () => {
			const result = parsePromptValueSync(defaultSchema(3000), undefined);
			expect(result).toBe(3000);
		});

		it("passes through defined values with default schema", () => {
			const result = parsePromptValueSync(defaultSchema(3000), 8080);
			expect(result).toBe(8080);
		});

		it("handles optional schema with defined value", () => {
			const result = parsePromptValueSync(optionalSchema<string>(), "hello");
			expect(result).toBe("hello");
		});

		it("handles optional schema with undefined value", () => {
			const result = parsePromptValueSync(optionalSchema<string>(), undefined);
			expect(result).toBeUndefined();
		});

		it("handles object transform schema", () => {
			const result = parsePromptValueSync(
				transformSchema({ port: 8080, host: "localhost" }),
				"config string",
			);
			expect(result).toEqual({ port: 8080, host: "localhost" });
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("throws on empty issues array with fallback message", () => {
			const schema: StandardSchema<unknown, never> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: () => ({ issues: [] }),
				},
			};
			try {
				parsePromptValueSync(schema, "bad");
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError<"VALIDATION">;
				expect(crustErr.code).toBe("VALIDATION");
				expect(crustErr.message).toBe("Prompt validation failed");
			}
		});

		it("handles null input", () => {
			const result = parsePromptValueSync(passthroughSchema<null>(), null);
			expect(result).toBeNull();
		});

		it("handles coercion failure with clear error", () => {
			try {
				parsePromptValueSync(coerceNumberSchema(), "not-a-number");
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError<"VALIDATION">;
				expect(crustErr.code).toBe("VALIDATION");
				expect(crustErr.message).toContain("Expected a number");
			}
		});
	});
});
