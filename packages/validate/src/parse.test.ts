import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parseValue } from "./parse.ts";
import type { StandardSchema } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — minimal Standard Schema implementations
// ────────────────────────────────────────────────────────────────────────────

function passthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T }),
		},
	};
}

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

function asyncPassthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async (value) => ({ value: value as T }),
		},
	};
}

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

function transformSchema<T>(output: T): StandardSchema<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ value: output }),
		},
	};
}

function asyncTransformSchema<T>(output: T): StandardSchema<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async () => ({ value: output }),
		},
	};
}

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
// parseValue — async typed parsing helper
// ────────────────────────────────────────────────────────────────────────────

describe("parseValue", () => {
	it("returns the passthrough value for a valid input", async () => {
		const result = await parseValue(passthroughSchema<string>(), "hello");
		expect(result).toBe("hello");
	});

	it("returns transformed output from a sync schema", async () => {
		const result = await parseValue(transformSchema(42), "any");
		expect(result).toBe(42);
	});

	it("returns transformed output from an async schema", async () => {
		const result = await parseValue(asyncTransformSchema(99), "any");
		expect(result).toBe(99);
	});

	it("returns coerced number from a string input", async () => {
		const result = await parseValue(coerceNumberSchema(), "8080");
		expect(result).toBe(8080);
	});

	it("throws CrustError(VALIDATION) on invalid input", async () => {
		try {
			await parseValue(
				failingSchema([{ message: "Must be a valid email" }]),
				"bad",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Validation failed");
			expect(crustErr.message).toContain("Must be a valid email");
		}
	});

	it("throws CrustError with structured issues on failure", async () => {
		try {
			await parseValue(
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
		const result = parseValue(passthroughSchema<string>(), "test");
		expect(result).toBeInstanceOf(Promise);
	});

	it("handles async schema success", async () => {
		const result = await parseValue(asyncPassthroughSchema<string>(), "valid");
		expect(result).toBe("valid");
	});

	it("handles async schema failure", async () => {
		try {
			await parseValue(asyncFailingSchema([{ message: "Async error" }]), "bad");
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Async error");
		}
	});

	describe("schema type scenarios", () => {
		it("handles default values for undefined input", async () => {
			const result = await parseValue(defaultSchema(3000), undefined);
			expect(result).toBe(3000);
		});

		it("passes through defined values with default schema", async () => {
			const result = await parseValue(defaultSchema(3000), 8080);
			expect(result).toBe(8080);
		});

		it("handles optional schema with defined value", async () => {
			const result = await parseValue(optionalSchema<string>(), "hello");
			expect(result).toBe("hello");
		});

		it("handles optional schema with undefined value", async () => {
			const result = await parseValue(optionalSchema<string>(), undefined);
			expect(result).toBeUndefined();
		});

		it("handles object transform schema", async () => {
			const schema = transformSchema({ port: 8080, host: "localhost" });
			const result = await parseValue(schema, "config string");
			expect(result).toEqual({ port: 8080, host: "localhost" });
		});

		it("handles array transform schema", async () => {
			const schema = transformSchema(["a", "b", "c"]);
			const result = await parseValue(schema, "input");
			expect(result).toEqual(["a", "b", "c"]);
		});
	});

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
				await parseValue(schema, "bad");
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError<"VALIDATION">;
				expect(crustErr.code).toBe("VALIDATION");
				expect(crustErr.message).toBe("Validation failed");
			}
		});

		it("handles null input", async () => {
			const result = await parseValue(passthroughSchema<null>(), null);
			expect(result).toBeNull();
		});

		it("handles boolean transform", async () => {
			const result = await parseValue(transformSchema(true), "yes");
			expect(result).toBe(true);
		});

		it("throws DEFINITION error for non-Standard-Schema input", async () => {
			try {
				// biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
				await parseValue({} as any, "x");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustError);
				expect((err as CrustError).code).toBe("DEFINITION");
			}
		});
	});
});
