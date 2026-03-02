import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustPlugin } from "@crustjs/core";
import { Crust, VALIDATION_MODE_ENV } from "@crustjs/core";
import { generateSkill } from "./generate.ts";
import { skillPlugin } from "./plugin.ts";
import { readInstalledVersion } from "./version.ts";

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

describe("skillPlugin auto-update", () => {
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

	it("does not install skills that are not yet present", async () => {
		const app = new Crust({ name: "no-auto-install", description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					scope: "project",
					command: false,
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const manifestPath = join(
			tmpDir,
			".opencode",
			"skills",
			"use-no-auto-install",
			"crust.json",
		);

		expect(await exists(manifestPath)).toBe(false);
	});

	it("auto-updates already-installed skills when version changes", async () => {
		const app = new Crust({ name: "update-test", description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					scope: "project",
					command: false,
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: { name: "update-test", description: "test", version: "1.0.0" },
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".opencode", "skills", "use-update-test");

		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");

		// Run plugin with v2.0.0 — should auto-update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readInstalledVersion(skillDir)).toBe("2.0.0");
	});

	it("auto-updates even when a prior plugin short-circuits middleware", async () => {
		const app = new Crust({ name: "order-test", description: "test" })
			.run(() => {})
			.use(shortCircuitPlugin())
			.use(
				skillPlugin({
					version: "2.0.0",
					scope: "project",
					command: false,
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: { name: "order-test", description: "test", version: "1.0.0" },
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".opencode", "skills", "use-order-test");

		// Run plugin with v2.0.0 behind a short-circuit — should still update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readInstalledVersion(skillDir)).toBe("2.0.0");
	});

	it("does not auto-update during validation mode", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";

		const app = new Crust({ name: "validation-test", description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					scope: "project",
					command: false,
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "validation-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".opencode", "skills", "use-validation-test");

		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			delete process.env[VALIDATION_MODE_ENV];
		}

		// Should still be v1.0.0 — validation mode skips auto-update
		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");
	});

	it("does not auto-update when autoUpdate is false", async () => {
		const app = new Crust({ name: "no-update-test", description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					autoUpdate: false,
					scope: "project",
					command: false,
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "no-update-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".opencode", "skills", "use-no-update-test");

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		// Should still be v1.0.0 — autoUpdate disabled
		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");
	});
});
