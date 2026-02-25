import { describe, expect, it } from "bun:test";
import { CrustStoreError, configDir, createStore } from "./index.ts";

describe("@crustjs/store", () => {
	it("should be importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
	});

	it("should export createStore", () => {
		expect(createStore).toBeDefined();
		expect(typeof createStore).toBe("function");
	});

	it("should export configDir", () => {
		expect(configDir).toBeDefined();
		expect(typeof configDir).toBe("function");
	});

	it("should export CrustStoreError", () => {
		expect(CrustStoreError).toBeDefined();
		expect(typeof CrustStoreError).toBe("function");
	});
});
