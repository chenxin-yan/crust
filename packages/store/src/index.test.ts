import { describe, expect, it } from "bun:test";
import { CrustStoreError } from "./index.ts";

describe("@crustjs/store", () => {
	it("should be importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
	});

	it("should export CrustStoreError", () => {
		expect(CrustStoreError).toBeDefined();
		expect(typeof CrustStoreError).toBe("function");
	});
});
