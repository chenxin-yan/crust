import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { detectPackageManager } from "./detect.ts";

// ────────────────────────────────────────────────────────────────────────────
// detectPackageManager()
// ────────────────────────────────────────────────────────────────────────────

describe("detectPackageManager", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "crust-detect-test-"));
		// Clear the env var so lockfile detection takes priority
		vi.stubEnv("npm_config_user_agent", undefined);
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	it("detects npm from package-lock.json ahead of a conflicting user agent", () => {
		vi.stubEnv("npm_config_user_agent", "bun/1.0.0");
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("npm");
	});

	it("prefers bun.lock over other lockfiles", () => {
		writeFileSync(join(tempDir, "bun.lock"), "");
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tempDir, "yarn.lock"), "");
		writeFileSync(join(tempDir, "package-lock.json"), "");
		expect(detectPackageManager(tempDir)).toBe("bun");
	});

	it("falls back to npm_config_user_agent for bun", () => {
		vi.stubEnv("npm_config_user_agent", "bun/1.0.0");
		expect(detectPackageManager(tempDir)).toBe("bun");
	});

	it("defaults to npm when no signals are present", () => {
		expect(detectPackageManager(tempDir)).toBe("npm");
	});
});
