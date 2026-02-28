import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustPlugin } from "@crustjs/core";
import { defineCommand, runCommand, VALIDATION_MODE_ENV } from "@crustjs/core";
import { skillPlugin } from "./plugin.ts";

function shortCircuitPlugin(): CrustPlugin {
	return {
		name: "short-circuit",
		async middleware() {
			// Intentionally stop the middleware chain without calling next()
		},
	};
}

async function exists(path: string): Promise<boolean> {
	return access(path)
		.then(() => true)
		.catch(() => false);
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const original = process.cwd;
	process.cwd = () => dir;
	try {
		return await fn();
	} finally {
		process.cwd = original;
	}
}

describe("skillPlugin auto-install ordering", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			tmpdir(),
			`crust-skill-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("auto-installs even when a prior plugin short-circuits middleware", async () => {
		const cmd = defineCommand({
			meta: { name: "order-test-a", description: "order test" },
			run() {},
		});

		await withCwd(tmpDir, () =>
			runCommand(cmd, {
				argv: [],
				plugins: [
					shortCircuitPlugin(),
					skillPlugin({
						version: "1.0.0",
						autoInstall: true,
						scope: "project",
						command: false,
					}),
				],
			}),
		);

		const manifestPath = join(
			tmpDir,
			".opencode",
			"skills",
			"use-order-test-a",
			"crust.json",
		);

		expect(await exists(manifestPath)).toBe(true);
	});

	it("auto-installs even when skillPlugin runs before a short-circuit plugin", async () => {
		const cmd = defineCommand({
			meta: { name: "order-test-b", description: "order test" },
			run() {},
		});

		await withCwd(tmpDir, () =>
			runCommand(cmd, {
				argv: [],
				plugins: [
					skillPlugin({
						version: "1.0.0",
						autoInstall: true,
						scope: "project",
						command: false,
					}),
					shortCircuitPlugin(),
				],
			}),
		);

		const manifestPath = join(
			tmpDir,
			".opencode",
			"skills",
			"use-order-test-b",
			"crust.json",
		);

		expect(await exists(manifestPath)).toBe(true);
	});

	it("does not auto-install during validation mode", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";

		const cmd = defineCommand({
			meta: { name: "order-test-validation", description: "order test" },
			run() {},
		});

		try {
			await withCwd(tmpDir, () =>
				runCommand(cmd, {
					argv: [],
					plugins: [
						skillPlugin({
							version: "1.0.0",
							autoInstall: true,
							scope: "project",
							command: false,
						}),
					],
				}),
			);
		} finally {
			delete process.env[VALIDATION_MODE_ENV];
		}

		const manifestPath = join(
			tmpDir,
			".opencode",
			"skills",
			"use-order-test-validation",
			"crust.json",
		);

		expect(await exists(manifestPath)).toBe(false);
	});
});
