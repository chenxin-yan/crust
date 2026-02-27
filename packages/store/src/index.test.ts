import { describe, expect, it } from "bun:test";
import {
	CrustStoreError,
	cacheDir,
	configDir,
	createStore,
	dataDir,
	stateDir,
} from "./index.ts";

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

	it("should export dataDir", () => {
		expect(dataDir).toBeDefined();
		expect(typeof dataDir).toBe("function");
	});

	it("should export stateDir", () => {
		expect(stateDir).toBeDefined();
		expect(typeof stateDir).toBe("function");
	});

	it("should export cacheDir", () => {
		expect(cacheDir).toBeDefined();
		expect(typeof cacheDir).toBe("function");
	});

	it("should export CrustStoreError", () => {
		expect(CrustStoreError).toBeDefined();
		expect(typeof CrustStoreError).toBe("function");
	});
});
