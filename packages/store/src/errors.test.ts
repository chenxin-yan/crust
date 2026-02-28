import { describe, expect, it } from "bun:test";
import { CrustStoreError } from "./errors.ts";

describe("CrustStoreError", () => {
	// ──────────────────────────────────────────────────────────────────────
	// Construction
	// ──────────────────────────────────────────────────────────────────────

	it("should construct with code, message, and details", () => {
		const err = new CrustStoreError("IO", "write failed", {
			path: "/tmp/config.json",
			operation: "write",
		});

		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(CrustStoreError);
		expect(err.name).toBe("CrustStoreError");
		expect(err.code).toBe("IO");
		expect(err.message).toBe("write failed");
		expect(err.details).toEqual({
			path: "/tmp/config.json",
			operation: "write",
		});
	});

	it("should construct PATH error with path details", () => {
		const err = new CrustStoreError("PATH", "invalid config path", {
			path: "relative/path",
		});

		expect(err.code).toBe("PATH");
		expect(err.details.path).toBe("relative/path");
	});

	it("should construct PARSE error with path details", () => {
		const err = new CrustStoreError("PARSE", "malformed JSON", {
			path: "/home/user/.config/app/config.json",
		});

		expect(err.code).toBe("PARSE");
		expect(err.details.path).toBe("/home/user/.config/app/config.json");
	});

	it("should construct IO error with operation context", () => {
		const err = new CrustStoreError("IO", "permission denied", {
			path: "/etc/config.json",
			operation: "read",
		});

		expect(err.code).toBe("IO");
		expect(err.details.path).toBe("/etc/config.json");
		expect(err.details.operation).toBe("read");
	});

	it("should construct IO error for delete operation", () => {
		const err = new CrustStoreError("IO", "file not found", {
			path: "/tmp/config.json",
			operation: "delete",
		});

		expect(err.details.operation).toBe("delete");
	});

	it("should construct VALIDATION error with issues", () => {
		const err = new CrustStoreError("VALIDATION", "validation failed", {
			operation: "write",
			issues: [
				{ message: "Expected string", path: "theme" },
				{ message: "Required", path: "verbose" },
			],
		});

		expect(err.code).toBe("VALIDATION");
		expect(err.message).toBe("validation failed");
		expect(err.details.operation).toBe("write");
		expect(err.details.issues).toHaveLength(2);
		expect(err.details.issues[0]?.message).toBe("Expected string");
		expect(err.details.issues[0]?.path).toBe("theme");
		expect(err.details.issues[1]?.message).toBe("Required");
	});

	it("should construct VALIDATION error for read operation", () => {
		const err = new CrustStoreError("VALIDATION", "config drift detected", {
			operation: "read",
			issues: [{ message: "unknown field", path: "extra" }],
		});

		expect(err.code).toBe("VALIDATION");
		expect(err.details.operation).toBe("read");
	});

	it("should construct VALIDATION error for update operation", () => {
		const err = new CrustStoreError("VALIDATION", "invalid update", {
			operation: "update",
			issues: [],
		});

		expect(err.code).toBe("VALIDATION");
		expect(err.details.operation).toBe("update");
		expect(err.details.issues).toHaveLength(0);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Type narrowing via .is()
	// ──────────────────────────────────────────────────────────────────────

	it("should narrow to PATH with .is()", () => {
		const err: CrustStoreError = new CrustStoreError("PATH", "bad path", {
			path: "/bad",
		});

		expect(err.is("PATH")).toBe(true);
		expect(err.is("PARSE")).toBe(false);
		expect(err.is("IO")).toBe(false);

		if (err.is("PATH")) {
			// Type-narrowed: err.details is PathErrorDetails
			expect(err.details.path).toBe("/bad");
		}
	});

	it("should narrow to PARSE with .is()", () => {
		const err: CrustStoreError = new CrustStoreError("PARSE", "bad json", {
			path: "/tmp/config.json",
		});

		expect(err.is("PARSE")).toBe(true);
		expect(err.is("PATH")).toBe(false);

		if (err.is("PARSE")) {
			expect(err.details.path).toBe("/tmp/config.json");
		}
	});

	it("should narrow to IO with .is()", () => {
		const err: CrustStoreError = new CrustStoreError("IO", "disk full", {
			path: "/tmp/config.json",
			operation: "write",
		});

		expect(err.is("IO")).toBe(true);
		expect(err.is("PATH")).toBe(false);

		if (err.is("IO")) {
			expect(err.details.operation).toBe("write");
			expect(err.details.path).toBe("/tmp/config.json");
		}
	});

	it("should narrow to VALIDATION with .is()", () => {
		const err: CrustStoreError = new CrustStoreError(
			"VALIDATION",
			"validation failed",
			{
				operation: "write",
				issues: [{ message: "bad value", path: "theme" }],
			},
		);

		expect(err.is("VALIDATION")).toBe(true);
		expect(err.is("PATH")).toBe(false);
		expect(err.is("PARSE")).toBe(false);
		expect(err.is("IO")).toBe(false);

		if (err.is("VALIDATION")) {
			expect(err.details.operation).toBe("write");
			expect(err.details.issues).toHaveLength(1);
			expect(err.details.issues[0]?.message).toBe("bad value");
		}
	});

	// ──────────────────────────────────────────────────────────────────────
	// Cause chaining via .withCause()
	// ──────────────────────────────────────────────────────────────────────

	it("should attach cause with .withCause()", () => {
		const original = new TypeError("unexpected type");
		const err = new CrustStoreError("PARSE", "invalid config", {
			path: "/tmp/config.json",
		}).withCause(original);

		expect(err.cause).toBe(original);
		expect(err.cause).toBeInstanceOf(TypeError);
	});

	it("should return this for fluent chaining", () => {
		const err = new CrustStoreError("IO", "write failed", {
			path: "/tmp/config.json",
			operation: "write",
		});
		const result = err.withCause(new Error("original"));

		// withCause returns the same instance
		expect(result).toBe(err);
	});

	it("should accept non-Error causes", () => {
		const err = new CrustStoreError("PARSE", "bad json", {
			path: "/tmp/config.json",
		}).withCause("string cause");

		expect(err.cause).toBe("string cause");
	});

	it("should have undefined cause by default", () => {
		const err = new CrustStoreError("PATH", "bad path", { path: "/bad" });
		expect(err.cause).toBeUndefined();
	});

	// ──────────────────────────────────────────────────────────────────────
	// Inheritance and identity
	// ──────────────────────────────────────────────────────────────────────

	it("should be catchable as Error", () => {
		try {
			throw new CrustStoreError("PARSE", "corrupt file", {
				path: "/tmp/config.json",
			});
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(CrustStoreError);
		}
	});

	it("should produce a meaningful string representation", () => {
		const err = new CrustStoreError("IO", "permission denied", {
			path: "/etc/config.json",
			operation: "read",
		});

		expect(err.toString()).toBe("CrustStoreError: permission denied");
	});

	it("should have a stack trace", () => {
		const err = new CrustStoreError("PATH", "invalid", { path: "" });
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain("CrustStoreError");
	});
});
