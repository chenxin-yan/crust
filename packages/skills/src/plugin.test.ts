import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	access,
	lstat,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
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
		const app = new Crust("no-auto-install")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const manifestPath = join(
			tmpDir,
			".agents",
			"skills",
			"no-auto-install",
			"crust.json",
		);

		expect(await exists(manifestPath)).toBe(false);
	});

	it("renders plugin-provided top-level instructions into SKILL.md", async () => {
		const app = new Crust("instruction-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
					instructions: [
						"Prefer readonly commands before mutating state.",
						"Ask for confirmation before destructive actions.",
					],
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "instruction-test",
					description: "test",
					version: "0.9.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const skillPath = join(
			tmpDir,
			".agents",
			"skills",
			"instruction-test",
			"SKILL.md",
		);
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain(
			"- Prefer readonly commands before mutating state.",
		);
		expect(content).toContain(
			"- Ask for confirmation before destructive actions.",
		);
	});

	it("renders plugin-provided markdown instructions into SKILL.md", async () => {
		const app = new Crust("markdown-instruction-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
					instructions: `Read the command docs before answering.

## Response Policy

- Prefer exact documented flags.
- Quote defaults only when they appear in the command file.`,
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "markdown-instruction-test",
					description: "test",
					version: "0.9.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const skillPath = join(
			tmpDir,
			".agents",
			"skills",
			"markdown-instruction-test",
			"SKILL.md",
		);
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain("Read the command docs before answering.");
		expect(content).toContain("## Response Policy");
		expect(content).toContain("- Prefer exact documented flags.");
	});

	it("auto-updates already-installed skills when version changes", async () => {
		const app = new Crust("update-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					defaultScope: "project",
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

		const skillDir = join(tmpDir, ".agents", "skills", "update-test");

		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");

		// Run plugin with v2.0.0 — should auto-update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readInstalledVersion(skillDir)).toBe("2.0.0");
	});

	it("auto-migrates a legacy install even when the version matches", async () => {
		const app = new Crust("legacy-migration-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		const legacyCanonicalDir = join(
			tmpDir,
			".crust",
			"skills",
			"use-legacy-migration-test",
		);
		const legacySkillDir = join(
			tmpDir,
			".agents",
			"skills",
			"use-legacy-migration-test",
		);
		await mkdir(legacyCanonicalDir, { recursive: true });
		await mkdir(legacySkillDir, { recursive: true });
		await writeFile(
			join(legacyCanonicalDir, "crust.json"),
			JSON.stringify({ name: "use-legacy-migration-test", version: "1.0.0" }),
		);
		await writeFile(
			join(legacySkillDir, "crust.json"),
			JSON.stringify({ name: "use-legacy-migration-test", version: "1.0.0" }),
		);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const currentSkillDir = join(
			tmpDir,
			".agents",
			"skills",
			"legacy-migration-test",
		);
		expect(await readInstalledVersion(currentSkillDir)).toBe("1.0.0");
		expect(await exists(legacySkillDir)).toBe(false);
	});

	it("prints auto-update message with Universal label", async () => {
		const app = new Crust("update-message-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "update-message-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;

		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			process.stderr.write = originalWrite;
		}

		const stderrOutput = stderrChunks.join("");
		expect(stderrOutput.includes("for Universal")).toBe(true);
		expect(stderrOutput.includes("for OpenCode")).toBe(false);
	});

	it("auto-updates even when a prior plugin short-circuits middleware", async () => {
		const app = new Crust("order-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(shortCircuitPlugin())
			.use(
				skillPlugin({
					version: "2.0.0",
					defaultScope: "project",
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

		const skillDir = join(tmpDir, ".agents", "skills", "order-test");

		// Run plugin with v2.0.0 behind a short-circuit — should still update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readInstalledVersion(skillDir)).toBe("2.0.0");
	});

	it("does not auto-update during validation mode", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";

		const app = new Crust("validation-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					defaultScope: "project",
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

		const skillDir = join(tmpDir, ".agents", "skills", "validation-test");

		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			delete process.env[VALIDATION_MODE_ENV];
		}

		// Should still be v1.0.0 — validation mode skips auto-update
		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");
	});

	it("does not auto-update when autoUpdate is false", async () => {
		const app = new Crust("no-update-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
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

		const skillDir = join(tmpDir, ".agents", "skills", "no-update-test");

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		// Should still be v1.0.0 — autoUpdate disabled
		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");
	});

	it("prints no changes when universal skills are already installed", async () => {
		const app = new Crust("no-change-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "no-change-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const logs: string[] = [];
		const originalLog = console.log;
		const originalIsTTY = Object.getOwnPropertyDescriptor(
			process.stdin,
			"isTTY",
		);
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});

		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill"] }));
		} finally {
			console.log = originalLog;
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
		}

		expect(logs.some((line) => line.includes("No changes."))).toBe(true);
		expect(
			logs.some((line) => line.includes('Installed "no-change-test"')),
		).toBe(false);
	});

	it("prints install output with Universal label", async () => {
		const app = new Crust("install-message-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		const logs: string[] = [];
		const originalLog = console.log;
		const originalIsTTY = Object.getOwnPropertyDescriptor(
			process.stdin,
			"isTTY",
		);
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});

		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill"] }));
		} finally {
			console.log = originalLog;
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
		}

		expect(logs.some((line) => line.includes("Universal →"))).toBe(true);
		expect(logs.some((line) => line.includes("OpenCode →"))).toBe(false);
	});

	it("runs manual skill update command", async () => {
		const app = new Crust("manual-update-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "manual-update-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".agents", "skills", "manual-update-test");
		expect(await readInstalledVersion(skillDir)).toBe("1.0.0");

		await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update"] }));

		expect(await readInstalledVersion(skillDir)).toBe("2.0.0");
	});

	it("renders top-level instructions when running manual skill update", async () => {
		const app = new Crust("manual-update-instructions-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
					instructions: [
						"Prefer readonly commands before mutating state.",
						"Ask for confirmation before destructive actions.",
					],
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "manual-update-instructions-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		await withCwd(tmpDir, () =>
			app.execute({ argv: ["skill", "update", "--scope", "project"] }),
		);

		const skillPath = join(
			tmpDir,
			".agents",
			"skills",
			"manual-update-instructions-test",
			"SKILL.md",
		);
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain(
			"- Prefer readonly commands before mutating state.",
		);
		expect(content).toContain(
			"- Ask for confirmation before destructive actions.",
		);
	});

	it("defaults to global scope in non-interactive update when defaultScope is unset", async () => {
		const app = new Crust("fallback-scope-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "2.0.0",
					autoUpdate: false,
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: app._node,
				meta: {
					name: "fallback-scope-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const projectSkillDir = join(
			tmpDir,
			".agents",
			"skills",
			"fallback-scope-test",
		);
		expect(await readInstalledVersion(projectSkillDir)).toBe("1.0.0");

		const originalIsTTY = Object.getOwnPropertyDescriptor(
			process.stdin,
			"isTTY",
		);
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});

		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
		}

		expect(await readInstalledVersion(projectSkillDir)).toBe("1.0.0");

		await withCwd(tmpDir, () =>
			app.execute({ argv: ["skill", "update", "--scope", "project"] }),
		);

		expect(await readInstalledVersion(projectSkillDir)).toBe("2.0.0");
	});

	it("respects installMode during interactive installs", async () => {
		const app = new Crust("copy-mode-test")
			.meta({ description: "test" })
			.run(() => {})
			.use(
				skillPlugin({
					version: "1.0.0",
					defaultScope: "project",
					installMode: "copy",
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(
			process.stdin,
			"isTTY",
		);
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});

		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
		}

		const outputDir = join(tmpDir, ".agents", "skills", "copy-mode-test");
		const canonicalDir = join(tmpDir, ".crust", "skills", "copy-mode-test");

		expect((await lstat(outputDir)).isSymbolicLink()).toBe(false);
		expect((await stat(canonicalDir)).isDirectory()).toBe(true);
	});
});
