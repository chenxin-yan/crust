import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import type { ValidationIssue } from "./types.ts";
import {
	assertSyncResult,
	formatPath,
	normalizeIssue,
	normalizeIssues,
	renderBulletList,
	throwValidationError,
} from "./validation.ts";

// ────────────────────────────────────────────────────────────────────────────
// formatPath
// ────────────────────────────────────────────────────────────────────────────

describe("formatPath", () => {
	it("returns empty string for empty path", () => {
		expect(formatPath([])).toBe("");
	});

	it("formats a single string key", () => {
		expect(formatPath(["flags"])).toBe("flags");
	});

	it("formats nested string keys with dot notation", () => {
		expect(formatPath(["flags", "verbose"])).toBe("flags.verbose");
	});

	it("formats numeric keys with bracket notation", () => {
		expect(formatPath(["args", 0])).toBe("args[0]");
	});

	it("formats multiple numeric keys", () => {
		expect(formatPath(["items", 0, "tags", 2])).toBe("items[0].tags[2]");
	});

	it("formats leading numeric key with brackets", () => {
		expect(formatPath([0])).toBe("[0]");
	});

	it("handles PathSegment objects with string keys", () => {
		expect(formatPath([{ key: "flags" }, { key: "output" }])).toBe(
			"flags.output",
		);
	});

	it("handles PathSegment objects with numeric keys", () => {
		expect(formatPath([{ key: "args" }, { key: 0 }])).toBe("args[0]");
	});

	it("handles mixed PropertyKey and PathSegment entries", () => {
		expect(formatPath(["flags", { key: "verbose" }])).toBe("flags.verbose");
		expect(formatPath([{ key: "items" }, 0, "name"])).toBe("items[0].name");
	});

	it("handles deeply nested paths", () => {
		expect(formatPath(["a", "b", "c", "d", "e"])).toBe("a.b.c.d.e");
	});

	it("handles symbol keys by converting to string", () => {
		const sym = Symbol("test");
		expect(formatPath([sym])).toBe("Symbol(test)");
	});

	it("handles consecutive numeric indexes", () => {
		expect(formatPath([0, 1, 2])).toBe("[0][1][2]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// normalizeIssue / normalizeIssues
// ────────────────────────────────────────────────────────────────────────────

describe("normalizeIssue", () => {
	it("normalizes issue with path", () => {
		const result = normalizeIssue({
			message: "Expected boolean",
			path: ["flags", "verbose"],
		});
		expect(result).toEqual({
			message: "Expected boolean",
			path: "flags.verbose",
		});
	});

	it("normalizes issue without path to empty string", () => {
		const result = normalizeIssue({ message: "Invalid input" });
		expect(result).toEqual({ message: "Invalid input", path: "" });
	});

	it("normalizes issue with undefined path to empty string", () => {
		const result = normalizeIssue({
			message: "Invalid input",
			path: undefined,
		});
		expect(result).toEqual({ message: "Invalid input", path: "" });
	});

	it("normalizes issue with PathSegment objects", () => {
		const result = normalizeIssue({
			message: "Required",
			path: [{ key: "args" }, { key: 0 }],
		});
		expect(result).toEqual({ message: "Required", path: "args[0]" });
	});
});

describe("normalizeIssues", () => {
	it("normalizes multiple issues", () => {
		const results = normalizeIssues([
			{ message: "Required", path: ["flags", "output"] },
			{ message: "Expected number", path: ["args", 0] },
			{ message: "Invalid input" },
		]);
		expect(results).toEqual([
			{ message: "Required", path: "flags.output" },
			{ message: "Expected number", path: "args[0]" },
			{ message: "Invalid input", path: "" },
		]);
	});

	it("returns empty array for empty input", () => {
		expect(normalizeIssues([])).toEqual([]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// renderBulletList
// ────────────────────────────────────────────────────────────────────────────

describe("renderBulletList", () => {
	it("renders issues with paths as bullet lines", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.verbose", message: "Expected boolean, received string" },
			{ path: "args[0]", message: "Required" },
		];
		const result = renderBulletList("Validation failed", issues);
		expect(result).toBe(
			"Validation failed\n  - flags.verbose: Expected boolean, received string\n  - args[0]: Required",
		);
	});

	it("renders issues without paths (root-level)", () => {
		const issues: ValidationIssue[] = [
			{ path: "", message: "Invalid input type" },
		];
		const result = renderBulletList("Validation failed", issues);
		expect(result).toBe("Validation failed\n  - Invalid input type");
	});

	it("renders mixed issues with and without paths", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.output", message: "Required" },
			{ path: "", message: "Extra fields not allowed" },
		];
		const result = renderBulletList("Validation failed", issues);
		expect(result).toBe(
			"Validation failed\n  - flags.output: Required\n  - Extra fields not allowed",
		);
	});

	it("renders single issue", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.count", message: "Expected number" },
		];
		const result = renderBulletList("Error", issues);
		expect(result).toBe("Error\n  - flags.count: Expected number");
	});

	it("renders with custom prefix", () => {
		const issues: ValidationIssue[] = [
			{ path: "args[0]", message: "Too short" },
		];
		const result = renderBulletList("Custom prefix message", issues);
		expect(result).toBe("Custom prefix message\n  - args[0]: Too short");
	});

	it("handles empty issues array", () => {
		const result = renderBulletList("Validation failed", []);
		expect(result).toBe("Validation failed");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// throwValidationError
// ────────────────────────────────────────────────────────────────────────────

describe("throwValidationError", () => {
	it("throws CrustError with VALIDATION code", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.verbose", message: "Expected boolean" },
		];
		expect(() => throwValidationError(issues)).toThrow(CrustError);
		try {
			throwValidationError(issues);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError;
			expect(crustErr.code).toBe("VALIDATION");
		}
	});

	it("formats message as bullet list with default prefix", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.output", message: "Required" },
			{ path: "args[0]", message: "Expected string" },
		];
		try {
			throwValidationError(issues);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError;
			expect(crustErr.message).toBe(
				"Validation failed\n  - flags.output: Required\n  - args[0]: Expected string",
			);
		}
	});

	it("formats message with custom prefix", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.count", message: "Expected number" },
		];
		try {
			throwValidationError(issues, "Schema validation error");
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError;
			expect(crustErr.message).toStartWith("Schema validation error\n");
		}
	});

	it("attaches raw issues as error.details.issues", () => {
		const issues: ValidationIssue[] = [
			{ path: "flags.verbose", message: "Expected boolean" },
			{ path: "", message: "Root error" },
		];
		try {
			throwValidationError(issues);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.details?.issues).toEqual(issues);
		}
	});

	it("error is narrowable with .is() method", () => {
		const issues: ValidationIssue[] = [{ path: "flags.x", message: "Invalid" }];
		try {
			throwValidationError(issues);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError;
			expect(crustErr.is("VALIDATION")).toBe(true);
			expect(crustErr.is("PARSE")).toBe(false);
			expect(crustErr.is("EXECUTION")).toBe(false);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// assertSyncResult
// ────────────────────────────────────────────────────────────────────────────

describe("assertSyncResult", () => {
	it("returns synchronous success result unchanged", () => {
		const result = { value: { name: "test" } };
		expect(assertSyncResult(result)).toBe(result);
	});

	it("returns synchronous failure result unchanged", () => {
		const result = { issues: [{ message: "Required" }] };
		expect(assertSyncResult(result)).toBe(result);
	});

	it("throws CrustError(VALIDATION) for async results", () => {
		const asyncResult = Promise.resolve({ value: { name: "test" } });
		expect(() => assertSyncResult(asyncResult)).toThrow(CrustError);
		try {
			assertSyncResult(asyncResult);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError;
			expect(crustErr.code).toBe("VALIDATION");
			expect(crustErr.message).toContain("Async validation is not supported");
			expect(crustErr.message).toContain("v1");
		}
	});

	it("throws with guidance message for async results", () => {
		const asyncResult = Promise.resolve({
			issues: [{ message: "fail" }],
		});
		try {
			assertSyncResult(asyncResult);
			expect.unreachable("should have thrown");
		} catch (err) {
			const crustErr = err as CrustError;
			expect(crustErr.message).toContain("synchronous schema");
		}
	});
});
