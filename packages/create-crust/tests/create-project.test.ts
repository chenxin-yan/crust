import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
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
		const runSteps = mock(async () => {});

		await createCrustProject(
			{
				resolvedDir: TEST_DIR,
				name: "install-test-cli",
				template: "minimal",
				distributionMode: "binary",
				installDeps: true,
				initGit: false,
			},
			{ runSteps },
		);

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(runSteps).toHaveBeenCalledTimes(1);
		expect(runSteps).toHaveBeenCalledWith([{ type: "install" }], TEST_DIR);
	});

	it("scaffolds a project without installing dependencies when skipped", async () => {
		const runSteps = mock(async () => {});

		await createCrustProject(
			{
				resolvedDir: TEST_DIR,
				name: "skip-install-cli",
				template: "minimal",
				distributionMode: "binary",
				installDeps: false,
				initGit: false,
			},
			{ runSteps },
		);

		expect(existsSync(resolve(TEST_DIR, "package.json"))).toBe(true);
		expect(runSteps).not.toHaveBeenCalled();

		const pkg = JSON.parse(
			readFileSync(resolve(TEST_DIR, "package.json"), "utf-8"),
		);
		expect(pkg.name).toBe("skip-install-cli");
	});
});
