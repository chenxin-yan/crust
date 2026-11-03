import { describe, expect, it } from "vite-plus/test";

import { CrustError } from "./errors.ts";

describe("CrustError instanceof", () => {
	it("keeps prototype-chain semantics for the class and subclasses", () => {
		class AppError extends CrustError<"PARSE"> {}
		const base = new CrustError("PARSE", "bad");
		const sub = new AppError("PARSE", "bad");

		expect(base instanceof CrustError).toBe(true);
		expect(sub instanceof CrustError).toBe(true);
		expect(sub instanceof AppError).toBe(true);
		expect(base instanceof AppError).toBe(false);
		expect(new Error("x") instanceof CrustError).toBe(false);
		expect({ code: "PARSE" } instanceof CrustError).toBe(false);
	});
});
