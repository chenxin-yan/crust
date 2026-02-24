import { describe, expect, it } from "bun:test";
import { CrustStoreError } from "./errors.ts";
import { runValidation } from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// runValidation — Unit tests
// ────────────────────────────────────────────────────────────────────────────

interface TestConfig {
	name: string;
	count: number;
}

describe("runValidation", () => {
	// ── No validator (passthrough) ────────────────────────────────────────

	it("returns input as-is when validator is undefined", () => {
		const input = { name: "test", count: 5 };
		const result = runValidation<TestConfig>(input, undefined);
		expect(result).toEqual(input);
	});

	it("enforces object-shaped config at compile time", () => {
		// @ts-expect-error — config type must be object-shaped
		runValidation<string>("hello", undefined);
		expect(true).toBe(true);
	});

	// ── Successful validation ─────────────────────────────────────────────

	it("returns validated value from successful validator", () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			return { name: obj.name, count: obj.count };
		};
		const input = { name: "test", count: 5 };
		const result = runValidation(input, validate);
		expect(result).toEqual({ name: "test", count: 5 });
	});

	it("allows validator to transform input", () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as Record<string, unknown>;
			return {
				name: String(obj.name ?? "default"),
				count: Number(obj.count ?? 0),
			};
		};
		const result = runValidation({}, validate);
		expect(result).toEqual({ name: "default", count: 0 });
	});

	// ── Validation failure — Error normalization ──────────────────────────

	it("wraps validator Error into CrustStoreError with VALIDATION code", () => {
		const validate = (_input: unknown): TestConfig => {
			throw new Error("name is required");
		};

		expect(() => runValidation({}, validate)).toThrow(CrustStoreError);

		try {
			runValidation({}, validate);
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.code).toBe("VALIDATION");
			expect(storeErr.message).toBe("Validation failed: name is required");
		}
	});

	it("wraps non-Error thrown value into CrustStoreError with generic message", () => {
		const validate = (_input: unknown): TestConfig => {
			throw "string error";
		};

		try {
			runValidation({}, validate);
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.code).toBe("VALIDATION");
			expect(storeErr.message).toBe("Validation failed");
		}
	});

	it("attaches original error as cause", () => {
		const original = new TypeError("invalid type");
		const validate = (_input: unknown): TestConfig => {
			throw original;
		};

		try {
			runValidation({}, validate);
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.cause).toBe(original);
		}
	});

	it("attaches non-Error cause", () => {
		const validate = (_input: unknown): TestConfig => {
			throw 42;
		};

		try {
			runValidation({}, validate);
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.cause).toBe(42);
		}
	});

	// ── File path context ─────────────────────────────────────────────────

	it("includes file path in error details when provided", () => {
		const validate = (_input: unknown): TestConfig => {
			throw new Error("bad value");
		};
		const filePath = "/home/user/.config/myapp/config.json";

		try {
			runValidation({}, validate, filePath);
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.details).toEqual({ path: filePath });
		}
	});

	it("omits file path from details when not provided", () => {
		const validate = (_input: unknown): TestConfig => {
			throw new Error("bad value");
		};

		try {
			runValidation({}, validate);
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.details).toBeUndefined();
		}
	});

	// ── Type narrowing with .is() ────────────────────────────────────────

	it("error is narrowable with .is('VALIDATION')", () => {
		const validate = (_input: unknown): TestConfig => {
			throw new Error("invalid");
		};

		try {
			runValidation({}, validate);
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("VALIDATION")).toBe(true);
			expect(storeErr.is("PARSE")).toBe(false);
			expect(storeErr.is("IO")).toBe(false);
			expect(storeErr.is("PATH")).toBe(false);
		}
	});

	// ── Composition with merge output ─────────────────────────────────────

	it("validates merged config values (integration-style)", () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as Record<string, unknown>;
			if (typeof obj.name !== "string") {
				throw new Error("name must be a string");
			}
			if (typeof obj.count !== "number") {
				throw new Error("count must be a number");
			}
			return { name: obj.name, count: obj.count };
		};

		// Simulates merged output from deepMerge
		const merged = { name: "app", count: 10 };
		const result = runValidation(merged, validate);
		expect(result).toEqual({ name: "app", count: 10 });
	});

	it("rejects invalid merged config values", () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as Record<string, unknown>;
			if (typeof obj.name !== "string") {
				throw new Error("name must be a string");
			}
			return input as TestConfig;
		};

		// Simulates merged output with invalid type
		const merged = { name: 123, count: 10 };
		expect(() => runValidation(merged, validate)).toThrow(CrustStoreError);
	});
});
