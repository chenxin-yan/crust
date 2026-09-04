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
			// Type-narrowed to PATH details.
			expect(err.details.path).toBe("/bad");
		}
	});

	// ──────────────────────────────────────────────────────────────────────
	// Error cause
	// ──────────────────────────────────────────────────────────────────────

	it("should attach a cause", () => {
		const original = new TypeError("unexpected type");
		const err = new CrustStoreError(
			"PARSE",
			"invalid config",
			{ path: "/tmp/config.json" },
			original,
		);

		expect(err.cause).toBe(original);
		expect(err.cause).toBeInstanceOf(TypeError);
	});
});
