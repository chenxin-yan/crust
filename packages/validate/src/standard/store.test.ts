import { describe, expect, it } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { storeValidator, storeValidatorSync } from "./store.ts";
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

/** Create a sync schema that transforms the output value. */
function transformSchema<I, O>(
	transform: (value: I) => O,
): StandardSchema<I, O> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: transform(value as I) }),
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

/** Create an async schema that transforms after a tick. */
function asyncTransformSchema<I, O>(
	transform: (value: I) => O,
): StandardSchema<I, O> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async (value) => ({ value: transform(value as I) }),
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
// storeValidator (async)
// ────────────────────────────────────────────────────────────────────────────

describe("storeValidator", () => {
	describe("valid configs", () => {
		it("returns ok: true with the original value for a passthrough schema", async () => {
			const validate = storeValidator(passthroughSchema());
			const config = { theme: "light", verbose: false };
			const result = await validate(config);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(config);
			}
		});

		it("returns the transformed value from the schema", async () => {
			const validate = storeValidator(
				transformSchema((v: { theme: string }) => ({
					...v,
					theme: v.theme.toLowerCase(),
				})),
			);
			const result = await validate({ theme: "DARK" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual({ theme: "dark" });
			}
		});

		it("works with async schemas", async () => {
			const validate = storeValidator(asyncPassthroughSchema());
			const config = { theme: "light" };
			const result = await validate(config);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(config);
			}
		});

		it("works with async transform schemas", async () => {
			const validate = storeValidator(
				asyncTransformSchema((v: { count: string }) => ({
					count: Number(v.count),
				})),
			);
			const result = await validate({ count: "42" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual({ count: 42 });
			}
		});
	});

	describe("invalid configs", () => {
		it("returns ok: false with normalized issues for a failing schema", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Expected string", path: ["theme"] }]),
			);
			const result = await validate({ theme: 123 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues).toHaveLength(1);
				expect(result.issues[0]).toEqual({
					message: "Expected string",
					path: "theme",
				});
			}
		});

		it("normalizes nested paths to dot-path strings", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Too short", path: ["database", "host"] }]),
			);
			const result = await validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("database.host");
			}
		});

		it("normalizes array index paths to bracket notation", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Invalid", path: ["items", 0] }]),
			);
			const result = await validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("items[0]");
			}
		});

		it("normalizes PathSegment object paths", async () => {
			const validate = storeValidator(
				failingSchema([
					{
						message: "Required",
						path: [{ key: "config" }, { key: "name" }],
					},
				]),
			);
			const result = await validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("config.name");
			}
		});

		it("handles root-level issues with empty path", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Invalid config object" }]),
			);
			const result = await validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]).toEqual({
					message: "Invalid config object",
					path: "",
				});
			}
		});

		it("returns multiple issues", async () => {
			const validate = storeValidator(
				failingSchema([
					{ message: "Required", path: ["theme"] },
					{ message: "Required", path: ["verbose"] },
					{ message: "Too short", path: ["token"] },
				]),
			);
			const result = await validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues).toHaveLength(3);
				expect(result.issues[0]).toEqual({
					message: "Required",
					path: "theme",
				});
				expect(result.issues[1]).toEqual({
					message: "Required",
					path: "verbose",
				});
				expect(result.issues[2]).toEqual({
					message: "Too short",
					path: "token",
				});
			}
		});

		it("works with async failing schemas", async () => {
			const validate = storeValidator(
				asyncFailingSchema([{ message: "Expected number", path: ["port"] }]),
			);
			const result = await validate({ port: "abc" });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues).toHaveLength(1);
				expect(result.issues[0]).toEqual({
					message: "Expected number",
					path: "port",
				});
			}
		});
	});

	describe("edge cases", () => {
		it("handles null input", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Expected object" }]),
			);
			const result = await validate(null);

			expect(result.ok).toBe(false);
		});

		it("handles undefined input", async () => {
			const validate = storeValidator(
				failingSchema([{ message: "Expected object" }]),
			);
			const result = await validate(undefined);

			expect(result.ok).toBe(false);
		});

		it("returns the same validator function for successive calls", async () => {
			const schema = passthroughSchema();
			const validate = storeValidator(schema);

			const r1 = await validate({ a: 1 });
			const r2 = await validate({ b: 2 });

			expect(r1.ok).toBe(true);
			expect(r2.ok).toBe(true);
			if (r1.ok && r2.ok) {
				expect(r1.value).toEqual({ a: 1 });
				expect(r2.value).toEqual({ b: 2 });
			}
		});

		it("handles schema with empty issues array", async () => {
			const validate = storeValidator(failingSchema([]));
			const result = await validate({});

			// Empty issues array still means failure (ok: false)
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues).toHaveLength(0);
			}
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// storeValidatorSync
// ────────────────────────────────────────────────────────────────────────────

describe("storeValidatorSync", () => {
	describe("valid configs", () => {
		it("returns ok: true with the original value for a passthrough schema", () => {
			const validate = storeValidatorSync(passthroughSchema());
			const config = { theme: "light", verbose: false };
			const result = validate(config);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(config);
			}
		});

		it("returns the transformed value from the schema", () => {
			const validate = storeValidatorSync(
				transformSchema((v: { theme: string }) => ({
					...v,
					theme: v.theme.toUpperCase(),
				})),
			);
			const result = validate({ theme: "dark" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual({ theme: "DARK" });
			}
		});
	});

	describe("invalid configs", () => {
		it("returns ok: false with normalized issues", () => {
			const validate = storeValidatorSync(
				failingSchema([{ message: "Expected string", path: ["theme"] }]),
			);
			const result = validate({ theme: 123 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues).toHaveLength(1);
				expect(result.issues[0]).toEqual({
					message: "Expected string",
					path: "theme",
				});
			}
		});

		it("normalizes nested and array paths", () => {
			const validate = storeValidatorSync(
				failingSchema([
					{ message: "Bad host", path: ["db", "host"] },
					{ message: "Bad port", path: ["ports", 0] },
				]),
			);
			const result = validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("db.host");
				expect(result.issues[1]?.path).toBe("ports[0]");
			}
		});

		it("handles root-level issues", () => {
			const validate = storeValidatorSync(
				failingSchema([{ message: "Invalid" }]),
			);
			const result = validate({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]).toEqual({
					message: "Invalid",
					path: "",
				});
			}
		});
	});

	describe("async schema rejection", () => {
		it("throws TypeError when schema returns a Promise", () => {
			const validate = storeValidatorSync(asyncPassthroughSchema());

			expect(() => validate({})).toThrow(TypeError);
			expect(() => validate({})).toThrow(
				/Schema returned a Promise from validate/,
			);
		});
	});

	describe("edge cases", () => {
		it("handles successive calls with different inputs", () => {
			const validate = storeValidatorSync(passthroughSchema());

			const r1 = validate({ x: 1 });
			const r2 = validate({ y: 2 });

			expect(r1.ok).toBe(true);
			expect(r2.ok).toBe(true);
			if (r1.ok && r2.ok) {
				expect(r1.value).toEqual({ x: 1 });
				expect(r2.value).toEqual({ y: 2 });
			}
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// StoreValidator contract compatibility — structural match with @crustjs/store
// ────────────────────────────────────────────────────────────────────────────

describe("StoreValidator contract compatibility", () => {
	it("async validator result is structurally compatible with StoreValidatorResult", async () => {
		const validate = storeValidator(passthroughSchema());
		const result = await validate({ theme: "light" });

		// StoreValidatorResult<T> expects: { ok: true, value: T } | { ok: false, issues: StoreValidatorIssue[] }
		expect(result).toHaveProperty("ok");
		if (result.ok) {
			expect(result).toHaveProperty("value");
		}
	});

	it("sync validator result is structurally compatible with StoreValidatorResult", () => {
		const validate = storeValidatorSync(passthroughSchema());
		const result = validate({ theme: "light" });

		expect(result).toHaveProperty("ok");
		if (result.ok) {
			expect(result).toHaveProperty("value");
		}
	});

	it("failure result issues have { message, path } shape matching StoreValidatorIssue", async () => {
		const validate = storeValidator(
			failingSchema([
				{ message: "Bad", path: ["theme"] },
				{ message: "Missing" },
			]),
		);
		const result = await validate({});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			for (const issue of result.issues) {
				expect(issue).toHaveProperty("message");
				expect(issue).toHaveProperty("path");
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}
	});

	it("async validator is callable as (value: unknown) => Promise<...>", async () => {
		const validate = storeValidator(passthroughSchema());

		// The function signature matches StoreValidator<T>: (value: unknown) => Promise<StoreValidatorResult<T>>
		expect(typeof validate).toBe("function");
		const result = validate({});
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it("sync validator is callable as (value: unknown) => ...", () => {
		const validate = storeValidatorSync(passthroughSchema());

		expect(typeof validate).toBe("function");
		const result = validate({});
		// Sync — not a Promise
		expect(result).not.toBeInstanceOf(Promise);
		expect(result.ok).toBe(true);
	});
});
