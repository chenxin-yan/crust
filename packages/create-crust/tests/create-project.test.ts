import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createCrustProject } from "../src/create-project.ts";

const TEST_DIR = resolve(import.meta.dirname, ".tmp-create-project-test");
const ORIGINAL_USER_AGENT = process.env.npm_config_user_agent;

beforeEach(() => {
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true, force: true });
	}

	process.env.npm_config_user_agent = "bun/1.3.10";
});

afterEach(() => {
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true, force: true });
	}

	if (ORIGINAL_USER_AGENT === undefined) {
		delete process.env.npm_config_user_agent;
	} else {
		process.env.npm_config_user_agent = ORIGINAL_USER_AGENT;
	}
});

describe("createCrustProject", () => {
	it("scaffolds a project and installs dependencies when requested", async () => {
		await createCrustProject({
			resolvedDir: TEST_DIR,
			name: "install-test-cli",
			template: "minimal",
			distributionMode: "binary",
			installDeps: true,
			initGit: false,
		});

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "bun.lock"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "node_modules"))).toBe(true);

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);

		// No leftover "latest" tags — every range must be a resolved semver.
		const allDepValues = [
			...Object.values(pkg.dependencies ?? {}),
			...Object.values(pkg.devDependencies ?? {}),
		];
		for (const value of allDepValues) {
			expect(value).not.toBe("latest");
		}

		// Every @crustjs/* entry must be a caret semver range
		// (prerelease allowed).
		const crustEntries = [
			...Object.entries(pkg.dependencies ?? {}),
			...Object.entries(pkg.devDependencies ?? {}),
		].filter(([name]) => name.startsWith("@crustjs/"));

		expect(crustEntries.length).toBeGreaterThan(0);
		for (const [, range] of crustEntries) {
			expect(range as string).toMatch(/^\^\d+\.\d+\.\d+(-.+)?$/);
		}
	}, 60_000);

	it("scaffolds a project without installing dependencies when skipped", async () => {
		await createCrustProject({
			resolvedDir: TEST_DIR,
			name: "skip-install-cli",
			template: "minimal",
			distributionMode: "binary",
			installDeps: false,
			initGit: false,
		});

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(existsSync(resolve(TEST_DIR, "bun.lock"))).toBe(false);
		expect(existsSync(resolve(TEST_DIR, "node_modules"))).toBe(false);

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("skip-install-cli");
	});
});
