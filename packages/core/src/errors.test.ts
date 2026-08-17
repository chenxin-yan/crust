import { describe, expect, it } from "bun:test";

import { CrustError } from "./errors.ts";

describe("CrustError shape", () => {
	it("serializes error metadata without a _tag and without serializing causes", () => {
		const cause = new Error("inner");
		const error = new CrustError("VALIDATION", "Failed", {
			issues: [{ message: "bad", path: "flags.x" }],
		}).withCause(cause);

		expect(error.toJSON()).toEqual({
			code: "VALIDATION",
			message: "Failed",
			details: { issues: [{ message: "bad", path: "flags.x" }] },
		});
		expect("_tag" in error).toBe(false);
	});
});
