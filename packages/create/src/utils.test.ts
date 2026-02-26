import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectPackageManager,
	getGitUser,
	isGitInstalled,
	isInGitRepo,
} from "./utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// detectPackageManager()
// ────────────────────────────────────────────────────────────────────────────

describe("detectPackageManager", () => {
	let tempDir: string;
	let originalUserAgent: string | undefined;

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`crust-utils-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempDir, { recursive: true });
		originalUserAgent = process.env.npm_config_user_agent;
		// Clear the env var so lockfile detection takes priority
		delete process.env.npm_config_user_agent;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		if (originalUserAgent !== undefined) {
			process.env.npm_config_user_agent = originalUserAgent;
		} else {
			delete process.env.npm_config_user_agent;
		}
	});

	it("detects bun from bun.lock", () => {
		writeFileSync(join(tempDir, "bun.lock"), "");
		expect(detectPackageManager(tempDir)).toBe("bun");
	});

	it("detects bun from bun.lockb", () => {
		writeFileSync(join(tempDir, "bun.lockb"), "");
		expect(detectPackageManager(tempDir)).toBe("bun");
	});

	it("detects pnpm from pnpm-lock.yaml", () => {
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("detects yarn from yarn.lock", () => {
		writeFileSync(join(tempDir, "yarn.lock"), "");
		expect(detectPackageManager(tempDir)).toBe("yarn");
	});

	it("detects npm from package-lock.json", () => {
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

	it("prefers pnpm over yarn and npm when bun is absent", () => {
		writeFileSync(join(tempDir, "pnpm-lock.yaml"), "");
		writeFileSync(join(tempDir, "yarn.lock"), "");
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("falls back to npm_config_user_agent for bun", () => {
		process.env.npm_config_user_agent = "bun/1.0.0";
		expect(detectPackageManager(tempDir)).toBe("bun");
	});

	it("falls back to npm_config_user_agent for pnpm", () => {
		process.env.npm_config_user_agent = "pnpm/8.0.0 npm/? node/v20.0.0";
		expect(detectPackageManager(tempDir)).toBe("pnpm");
	});

	it("falls back to npm_config_user_agent for yarn", () => {
		process.env.npm_config_user_agent = "yarn/4.0.0 npm/? node/v20.0.0";
		expect(detectPackageManager(tempDir)).toBe("yarn");
	});

	it("falls back to npm_config_user_agent for npm", () => {
		process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
		expect(detectPackageManager(tempDir)).toBe("npm");
	});

	it("defaults to npm when no signals are present", () => {
		expect(detectPackageManager(tempDir)).toBe("npm");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isInGitRepo()
// ────────────────────────────────────────────────────────────────────────────

describe("isInGitRepo", () => {
	it("returns true for a directory inside a git repo", () => {
		// This test file is inside the crust monorepo
		expect(isInGitRepo(process.cwd())).toBe(true);
	});

	it("returns false for a directory outside any git repo", () => {
		// /tmp is not inside a git repo
		expect(isInGitRepo(tmpdir())).toBe(false);
	});

	it("returns true for a subdirectory of a git repo", () => {
		const subDir = join(
			tmpdir(),
			`crust-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(subDir, { recursive: true });
		// Init a repo, then check a subdirectory
		Bun.spawnSync(["git", "init"], {
			cwd: subDir,
			stdout: "ignore",
			stderr: "ignore",
		});
		const nested = join(subDir, "nested");
		mkdirSync(nested, { recursive: true });

		expect(isInGitRepo(nested)).toBe(true);

		rmSync(subDir, { recursive: true, force: true });
	});

	it("defaults to process.cwd() when no argument is provided", () => {
		// cwd is inside the monorepo
		expect(isInGitRepo()).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isGitInstalled()
// ────────────────────────────────────────────────────────────────────────────

describe("isGitInstalled", () => {
	it("returns true when git is available", () => {
		// Git is expected to be available in the test environment
		expect(isGitInstalled()).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// getGitUser()
// ────────────────────────────────────────────────────────────────────────────

describe("getGitUser", () => {
	it("returns an object with name and email keys", () => {
		const user = getGitUser();
		expect(user).toHaveProperty("name");
		expect(user).toHaveProperty("email");
	});

	it("returns strings or null for name and email", () => {
		const user = getGitUser();
		expect(typeof user.name === "string" || user.name === null).toBe(true);
		expect(typeof user.email === "string" || user.email === null).toBe(true);
	});
});
