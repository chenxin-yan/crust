import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Crust, defineExtension } from "@crustjs/core";
import { snapshotCommand, VALIDATION_MODE_ENV } from "@crustjs/core/tooling";

import { installSkillBundle } from "./bundle.ts";
import { generateSkill } from "./generate.ts";
import { skillExtension } from "./plugin.ts";
import { readInstalledManifest } from "./version.ts";

const FIXTURE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"tests",
	"fixtures",
	"bundle",
);
const FIXTURE_DIR_SECOND = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"tests",
	"fixtures",
	"bundle-second",
);
const realHomedir = os.homedir;

function mockHomedir(path: string): void {
	// Bun caches homedir(), so changing HOME after startup does not redirect global paths.
	void mock.module("node:os", () => ({ ...os, homedir: () => path }));
}

function restoreHomedir(): void {
	void mock.module("node:os", () => ({ ...os, homedir: realHomedir }));
}

function shortCircuitExtension() {
	return defineExtension("short-circuit", {
		hooks: { preRun: (context) => context.finish() },
	});
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

describe("skill extension auto-update", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			os.tmpdir(),
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
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const manifestPath = join(tmpDir, ".agents", "skills", "no-auto-install", "crust.json");

		expect(await exists(manifestPath)).toBe(false);
	});

	it("renders plugin-provided top-level instructions into SKILL.md", async () => {
		const app = new Crust("instruction-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
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
				command: snapshotCommand(app._node),
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

		const skillPath = join(tmpDir, ".agents", "skills", "instruction-test", "SKILL.md");
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain("- Prefer readonly commands before mutating state.");
		expect(content).toContain("- Ask for confirmation before destructive actions.");
	});

	it("renders plugin-provided markdown instructions into SKILL.md", async () => {
		const app = new Crust("markdown-instruction-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
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
				command: snapshotCommand(app._node),
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

		const skillPath = join(tmpDir, ".agents", "skills", "markdown-instruction-test", "SKILL.md");
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain("Read the command docs before answering.");
		expect(content).toContain("## Response Policy");
		expect(content).toContain("- Prefer exact documented flags.");
	});

	it("auto-updates already-installed skills when version changes", async () => {
		const app = new Crust("update-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: { name: "update-test", description: "test", version: "1.0.0" },
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".agents", "skills", "update-test");

		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("1.0.0");

		// Run plugin with v2.0.0 — should auto-update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("2.0.0");
	});

	it("prints auto-update message with Universal label", async () => {
		const app = new Crust("update-message-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
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
		process.stderr.write = (chunk: unknown) => {
			stderrChunks.push(String(chunk));
			return true;
		};

		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			process.stderr.write = originalWrite;
		}

		const stderrOutput = stderrChunks.join("");
		expect(stderrOutput.includes("for Universal")).toBe(true);
		expect(stderrOutput.includes("for OpenCode")).toBe(false);
	});

	it("auto-updates before a later extension short-circuits (registration order matters)", async () => {
		// Pre-run hooks run in registration order; registering skills first means
		// its auto-update work happens before any later short-circuit.
		const app = new Crust("order-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
				}),
			)
			.extend(shortCircuitExtension());

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: { name: "order-test", description: "test", version: "1.0.0" },
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const skillDir = join(tmpDir, ".agents", "skills", "order-test");

		// Run plugin with v2.0.0 behind a short-circuit — should still update
		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("2.0.0");
	});

	it("does not auto-update during validation mode", async () => {
		process.env[VALIDATION_MODE_ENV] = "1";

		const app = new Crust("validation-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
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
		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("1.0.0");
	});

	it("does not auto-update when autoUpdate is false", async () => {
		const app = new Crust("no-update-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
				}),
			);

		// Pre-install v1.0.0
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
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
		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("1.0.0");
	});

	it("prints no changes when universal skills are already installed", async () => {
		const app = new Crust("no-change-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
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
		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
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
		expect(logs.some((line) => line.includes("Agents supporting universal skills:"))).toBe(false);
		expect(logs.some((line) => line.includes('Installed "no-change-test"'))).toBe(false);
	});

	it("runs manual skill update command", async () => {
		const app = new Crust("manual-update-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
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
		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("1.0.0");

		await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update"] }));

		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("2.0.0");
	});

	it("reports global scope when updating from the home directory", async () => {
		const app = new Crust("manual-home-update-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
				}),
			);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		mockHomedir(tmpDir);

		try {
			await withCwd(tmpDir, () =>
				generateSkill({
					command: snapshotCommand(app._node),
					meta: {
						name: "manual-home-update-test",
						description: "test",
						version: "1.0.0",
					},
					agents: ["opencode"],
					scope: "global",
				}),
			);

			const skillDir = join(tmpDir, ".agents", "skills", "manual-home-update-test");
			expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("1.0.0");

			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));

			expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("2.0.0");
		} finally {
			console.log = originalLog;
			restoreHomedir();
		}

		expect(logs.some((line) => line.includes("(global)"))).toBe(true);
		expect(logs.some((line) => line.includes("(project)"))).toBe(false);
	});

	it("reports no updates needed with global scope from the home directory", async () => {
		const app = new Crust("manual-home-noop-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
				}),
			);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		mockHomedir(tmpDir);

		try {
			await withCwd(tmpDir, () =>
				generateSkill({
					command: snapshotCommand(app._node),
					meta: {
						name: "manual-home-noop-test",
						description: "test",
						version: "2.0.0",
					},
					agents: ["opencode"],
					scope: "global",
				}),
			);

			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));
		} finally {
			console.log = originalLog;
			restoreHomedir();
		}

		expect(logs.some((line) => line.includes("No updates needed (global)."))).toBe(true);
		expect(logs.some((line) => line.includes("(project)"))).toBe(false);
	});

	it("renders top-level instructions when running manual skill update", async () => {
		const app = new Crust("manual-update-instructions-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
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
				command: snapshotCommand(app._node),
				meta: {
					name: "manual-update-instructions-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));

		const skillPath = join(
			tmpDir,
			".agents",
			"skills",
			"manual-update-instructions-test",
			"SKILL.md",
		);
		const content = await readFile(skillPath, "utf-8");

		expect(content).toContain("## General Guidance");
		expect(content).toContain("- Prefer readonly commands before mutating state.");
		expect(content).toContain("- Ask for confirmation before destructive actions.");
	});

	it("defaults to global scope in non-interactive update when defaultScope is unset", async () => {
		const app = new Crust("fallback-scope-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: {
					name: "fallback-scope-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		const projectSkillDir = join(tmpDir, ".agents", "skills", "fallback-scope-test");
		expect((await readInstalledManifest(projectSkillDir))?.version ?? null).toBe("1.0.0");

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
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

		expect((await readInstalledManifest(projectSkillDir))?.version ?? null).toBe("1.0.0");

		await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));

		expect((await readInstalledManifest(projectSkillDir))?.version ?? null).toBe("2.0.0");
	});
});

// ─────────────────────────────────────────────────────────────────────────
// customSkills — setup-time validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Helper for validation tests: Crust's `setup()` hooks throw asynchronously
 * but `execute()` catches the error, prints `Error: <message>` to stderr,
 * and sets `process.exitCode = 1`. Capture stderr + reset exitCode so the
 * test can assert on the message.
 */
async function captureSetupError(fn: () => Promise<void>): Promise<{
	stderr: string;
	exitCode: number | undefined;
}> {
	const stderrChunks: string[] = [];
	const origErr = console.error;
	// Reset process.exitCode so the test can observe what `execute()` set
	// without picking up stale state from a previous test. Restore to 0
	// afterwards so a non-zero exitCode set by `execute()` does not leak
	// into the bun:test runner's final exit code.
	process.exitCode = 0;
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.join(" "));
	};
	try {
		await fn();
	} finally {
		console.error = origErr;
	}
	const exitCode = process.exitCode as number | undefined;
	process.exitCode = 0;
	return { stderr: stderrChunks.join("\n"), exitCode };
}

describe("skillPlugin customSkills validation", () => {
	it("accepts an empty array", async () => {
		const app = new Crust("empty-custom")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [],
				}),
			);

		// Empty `customSkills` must be a true no-op: setup completes, no
		// warnings surface, and exit code stays 0.
		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		const origExitCode = process.exitCode;
		process.exitCode = 0;
		try {
			await expect(app.execute({ argv: [] })).resolves.toBeUndefined();
		} finally {
			console.warn = origWarn;
			process.exitCode = origExitCode;
		}
		expect(warnings).toEqual([]);
	});

	it("accepts a URL sourceDir", async () => {
		const app = new Crust("url-custom")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: pathToFileURL(`${FIXTURE_DIR}/`),
							version: "1.0.0",
						},
					],
					autoUpdate: false,
				}),
			);

		await expect(app.execute({ argv: [] })).resolves.toBeUndefined();
	});

	it("accepts an absolute string sourceDir", async () => {
		const app = new Crust("abs-custom")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
					autoUpdate: false,
				}),
			);

		await expect(app.execute({ argv: [] })).resolves.toBeUndefined();
	});

	it("accepts a relative string sourceDir at setup (resolution defers to install)", async () => {
		// Setup must not throw — resolution-time errors defer to installSkillBundle.
		const app = new Crust("rel-custom")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: "some/relative/path",
							version: "1.0.0",
						},
					],
					autoUpdate: false,
				}),
			);

		// No bundle is installed, so autoUpdate sweep finds nothing and exits.
		await expect(app.execute({ argv: [] })).resolves.toBeUndefined();
	});

	it("rejects a name that collides with the main skill", async () => {
		const app = new Crust("collide-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "collide-test",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		const { stderr, exitCode } = await captureSetupError(() => app.execute({ argv: [] }));

		expect(stderr).toMatch(/collides with the main skill name/);
		expect(exitCode).toBe(1);
	});

	it("rejects duplicate names within the array", async () => {
		const app = new Crust("dup-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "2.0.0",
						},
					],
				}),
			);

		const { stderr, exitCode } = await captureSetupError(() => app.execute({ argv: [] }));

		expect(stderr).toMatch(/duplicate name "funnel-builder"/);
		expect(exitCode).toBe(1);
	});

	it("rejects an invalid skill name", async () => {
		const app = new Crust("invalid-name-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "Invalid Name!",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		const { stderr, exitCode } = await captureSetupError(() => app.execute({ argv: [] }));

		expect(stderr).toMatch(/is not a valid skill name/);
		expect(exitCode).toBe(1);
	});

	it("rejects an empty version string when set", async () => {
		// `version` is optional and inherits from the plugin when omitted, but
		// an explicit empty string is still rejected so a typo can't silently
		// fall through to the plugin-level fallback.
		const app = new Crust("empty-version-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "",
						},
					],
				}),
			);

		const { stderr, exitCode } = await captureSetupError(() => app.execute({ argv: [] }));

		expect(stderr).toMatch(/must be a non-empty string when set/);
		expect(exitCode).toBe(1);
	});

	it("rejects a non-string non-URL sourceDir", async () => {
		const app = new Crust("bad-src-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: 42 as any,
							version: "1.0.0",
						},
					],
				}),
			);

		const { stderr, exitCode } = await captureSetupError(() => app.execute({ argv: [] }));

		expect(stderr).toMatch(/must be a string or URL/);
		expect(exitCode).toBe(1);
	});
});

describe("skillPlugin customSkills name mismatch", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			os.tmpdir(),
			`crust-skill-plugin-name-mismatch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("refuses to install when entry.name disagrees with SKILL.md frontmatter name", async () => {
		// Pre-install pricing-toolkit at v1.0.0 (using its real fixture) so the
		// auto-update path actually invokes installSkillBundle for that entry.
		// The plugin entry then points at FIXTURE_DIR (whose frontmatter
		// declares funnel-builder) — expectedName must reject the mismatch.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR_SECOND,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		const pricingDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("1.0.0");

		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};

		const app = new Crust("name-mismatch-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							// Config name claims pricing-toolkit, but FIXTURE_DIR's
							// SKILL.md frontmatter declares funnel-builder. Without
							// expectedName enforcement, the funnel-builder install
							// would silently install at v2.0.0 under the wrong
							// directory.
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR,
							version: "2.0.0",
						},
					],
				}),
			);

		const origExitCode = process.exitCode;
		process.exitCode = 0;
		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			console.warn = origWarn;
			process.exitCode = origExitCode;
		}

		// pricing-toolkit must remain at 1.0.0 — the install was rejected.
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("1.0.0");
		// No orphan funnel-builder dir was created.
		await expect(stat(funnelDir)).rejects.toThrow();
		// The mismatch warning surfaces with both names so the bundle author
		// can see exactly what disagreed.
		expect(
			warnings.some((line) => line.includes("pricing-toolkit") && line.includes("funnel-builder")),
		).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// customSkills — autoUpdate behavior
// ─────────────────────────────────────────────────────────────────────────

describe("skillPlugin customSkills auto-update", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			os.tmpdir(),
			`crust-skill-plugin-custom-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("auto-updates an installed bundle when version changes", async () => {
		// Pre-install bundle at v1.0.0 in tmpDir.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");

		const app = new Crust("bundle-update-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "2.0.0",
						},
					],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("2.0.0");
	});

	it("does not auto-update an up-to-date bundle", async () => {
		// Pre-install bundle at v1.0.0; plugin will run with same version.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		// Drop a sentinel inside the installed bundle. If the auto-update path
		// rewrites the bundle (clean: true), the sentinel is removed; if it
		// short-circuits as up-to-date, the sentinel survives. This is more
		// reliable than mtime equality on coarse-resolution filesystems.
		const sentinel = join(bundleDir, ".sentinel");
		await writeFile(sentinel, "do-not-touch");

		const app = new Crust("bundle-noop-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readFile(sentinel, "utf8")).toBe("do-not-touch");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");
	});

	it("continues after a per-bundle error so other bundles still update", async () => {
		// Pre-install bundle-second at v1.0.0; the first entry has a bogus
		// sourceDir which should fail at install time — the second entry should
		// still be reconciled.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR_SECOND,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const secondDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");
		expect((await readInstalledManifest(secondDir))?.version ?? null).toBe("1.0.0");

		// Pre-install funnel-builder at v1.0.0 too so the bogus first entry
		// triggers a sourceDir resolution error during the install path.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		expect((await readInstalledManifest(funnelDir))?.version ?? null).toBe("1.0.0");

		const originalWrite = process.stderr.write;
		process.stderr.write = () => true;
		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};

		const app = new Crust("bundle-resilience-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							// Bogus path — install will throw at resolve time.
							sourceDir: "/nonexistent/path/to/funnel-builder",
							version: "2.0.0",
						},
						{
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR_SECOND,
							version: "2.0.0",
						},
					],
				}),
			);

		try {
			await withCwd(tmpDir, () => app.execute({ argv: [] }));
		} finally {
			process.stderr.write = originalWrite;
			console.warn = origWarn;
		}

		// Second bundle still updated, despite first entry's error.
		expect((await readInstalledManifest(secondDir))?.version ?? null).toBe("2.0.0");
		// First bundle stayed at its previous version.
		expect((await readInstalledManifest(funnelDir))?.version ?? null).toBe("1.0.0");
		// Warning surfaced naming the failed bundle.
		expect(warnings.some((line) => line.includes("[funnel-builder]"))).toBe(true);
	});

	it("skips bundle auto-update when autoUpdate is false", async () => {
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");

		const app = new Crust("no-auto-update-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "2.0.0",
						},
					],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");
	});

	it("skips bundle auto-update when invoking the skill subcommand", async () => {
		// Pre-install at v1.0.0; configure entry with a bogus sourceDir at
		// v2.0.0. Both the auto-update setup hook and the `skill update`
		// subcommand would *try* to reconcile this entry, and both would emit
		// a warning when the install fails. Counting warnings is the only
		// instrument-free way to distinguish "both ran" (2 warnings) from
		// "only subcommand ran" (1 warning).
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");

		const app = new Crust("subcmd-skip-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: "/nonexistent/path/to/funnel-builder",
							version: "2.0.0",
						},
					],
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const warnings: string[] = [];
		const origLog = console.log;
		const origWarn = console.warn;
		console.log = () => {};
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		// Reset exitCode — `skill update` will set it on the failed bundle.
		const origExitCode = process.exitCode;
		process.exitCode = 0;
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
			console.log = origLog;
			console.warn = origWarn;
			process.exitCode = origExitCode;
		}

		// Bundle stayed at v1.0.0 because the bogus sourceDir failed install.
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");
		// Exactly one warning naming the failed bundle — only the `skill
		// update` subcommand ran. If the auto-update setup hook also ran,
		// there would be two warnings.
		const funnelWarnings = warnings.filter((line) => line.includes("[funnel-builder]"));
		expect(funnelWarnings.length).toBe(1);
	});

	it("does not install bundles when customSkills is omitted", async () => {
		// Same as the existing "auto-updates already-installed skills" test but
		// asserts that no bundle directory is ever created.
		const app = new Crust("identical-test")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: {
					name: "identical-test",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		const skillDir = join(tmpDir, ".agents", "skills", "identical-test");
		expect((await readInstalledManifest(skillDir))?.version ?? null).toBe("2.0.0");

		// No funnel-builder dir was created.
		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		await expect(stat(funnelDir)).rejects.toThrow();
	});

	it("inherits plugin-level version when entry omits version", async () => {
		// Pre-install bundle at v1.0.0.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");

		// Plugin-level version is bumped to 2.0.0; entry omits `version`, so
		// it should inherit and trigger a reinstall to 2.0.0.
		const app = new Crust("inherit-version-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							// version omitted on purpose — must inherit
							// `version: "2.0.0"` from the plugin.
						},
					],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("2.0.0");
	});

	it("explicit entry version overrides plugin-level version", async () => {
		// Pre-install bundle at v1.0.0.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");

		// Plugin says 2.0.0 but the entry pins itself at 0.3.0 — a vendored
		// bundle whose cadence is independent of the consuming CLI.
		const app = new Crust("override-version-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "0.3.0",
						},
					],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		// Bundle now records the explicit override, not the plugin-level
		// version.
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("0.3.0");
	});

	it("does not reinstall an inherited-version bundle when plugin version is unchanged", async () => {
		// Pre-install at the same version the plugin will report. Auto-update
		// should see no diff and skip the rewrite.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const bundleDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		const sentinel = join(bundleDir, ".sentinel");
		await writeFile(sentinel, "do-not-touch");

		const app = new Crust("inherit-noop-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [{ name: "funnel-builder", sourceDir: FIXTURE_DIR }],
				}),
			);

		await withCwd(tmpDir, () => app.execute({ argv: [] }));

		expect(await readFile(sentinel, "utf8")).toBe("do-not-touch");
		expect((await readInstalledManifest(bundleDir))?.version ?? null).toBe("1.0.0");
	});
});

// ─────────────────────────────────────────────────────────────────────────
// customSkills — interactive `skill` command
// ─────────────────────────────────────────────────────────────────────────

describe("skillPlugin customSkills interactive command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			os.tmpdir(),
			`crust-skill-plugin-custom-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("--all installs main + every bundle without prompting", async () => {
		const app = new Crust("all-flag-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
						{
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR_SECOND,
							version: "1.0.0",
						},
					],
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const origLog = console.log;
		console.log = () => {};
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "--all"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
			console.log = origLog;
		}

		const mainDir = join(tmpDir, ".agents", "skills", "all-flag-host");
		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		const pricingDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");

		expect((await readInstalledManifest(mainDir))?.version ?? null).toBe("1.0.0");
		expect((await readInstalledManifest(funnelDir))?.version ?? null).toBe("1.0.0");
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("1.0.0");
	});

	it("prints sequential per-skill output (heading mentions bundle name)", async () => {
		const app = new Crust("sequential-output-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "--all"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
			console.log = origLog;
		}

		// Main heading uses original "Installed <name>" form.
		expect(logs.some((line) => line.includes('Installed "sequential-output-host"'))).toBe(true);
		// Bundle heading mentions the bundle keyword and bundle name.
		expect(logs.some((line) => line.includes("bundle") && line.includes('"funnel-builder"'))).toBe(
			true,
		);
	});

	it("--all honors explicit --scope flag over defaultScope", async () => {
		// Plugin defaultScope is "project", but `--scope global` should win.
		// Bundle should land in the global scope, not the project scope.
		const app = new Crust("all-scope-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const projectDir = join(tmpDir, "project");
		await mkdir(projectDir);
		mockHomedir(tmpDir);
		const origLog = console.log;
		console.log = () => {};
		try {
			await withCwd(projectDir, () =>
				app.execute({ argv: ["skill", "--all", "--scope", "global"] }),
			);
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
			console.log = origLog;
			restoreHomedir();
		}

		const projectBundle = join(projectDir, ".agents", "skills", "funnel-builder");
		// Project-scope path must NOT exist — the explicit --scope flag wins.
		await expect(stat(projectBundle)).rejects.toThrow();
	});

	it("--all isolates per-bundle failures and exits non-zero", async () => {
		const app = new Crust("all-isolation-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							// Bogus path — install rejects at resolve time.
							sourceDir: "/nonexistent/path/to/funnel-builder",
							version: "1.0.0",
						},
						{
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR_SECOND,
							version: "1.0.0",
						},
					],
				}),
			);

		const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const warnings: string[] = [];
		const origLog = console.log;
		const origWarn = console.warn;
		console.log = () => {};
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		const origExitCode = process.exitCode;
		process.exitCode = 0;
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "--all"] }));
		} finally {
			if (originalIsTTY) {
				Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
			}
			console.log = origLog;
			console.warn = origWarn;
		}

		// Second bundle still installed.
		const pricingDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("1.0.0");
		// First bundle was rejected.
		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		await expect(stat(funnelDir)).rejects.toThrow();
		// Warning surfaced naming the failed bundle.
		expect(warnings.some((line) => line.includes("[funnel-builder]"))).toBe(true);
		// Exit code is non-zero so CI/scripts notice the partial failure.
		expect(process.exitCode).toBe(1);
		process.exitCode = origExitCode;
	});
});

// ─────────────────────────────────────────────────────────────────────────
// customSkills — `skill update` subcommand
// ─────────────────────────────────────────────────────────────────────────

describe("skillPlugin customSkills `skill update`", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			os.tmpdir(),
			`crust-skill-plugin-custom-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("updates main + every bundle in sequence", async () => {
		const app = new Crust("update-loop-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "2.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "2.0.0",
						},
						{
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR_SECOND,
							version: "2.0.0",
						},
					],
				}),
			);

		// Pre-install all three at v1.0.0.
		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: {
					name: "update-loop-host",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR_SECOND,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const origLog = console.log;
		console.log = () => {};
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));
		} finally {
			console.log = origLog;
		}

		const mainDir = join(tmpDir, ".agents", "skills", "update-loop-host");
		const funnelDir = join(tmpDir, ".agents", "skills", "funnel-builder");
		const pricingDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");

		expect((await readInstalledManifest(mainDir))?.version ?? null).toBe("2.0.0");
		expect((await readInstalledManifest(funnelDir))?.version ?? null).toBe("2.0.0");
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("2.0.0");
	});

	it("reports per-skill 'No updates needed' when nothing is outdated", async () => {
		const app = new Crust("update-noop-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: FIXTURE_DIR,
							version: "1.0.0",
						},
					],
				}),
			);

		await withCwd(tmpDir, () =>
			generateSkill({
				command: snapshotCommand(app._node),
				meta: {
					name: "update-noop-host",
					description: "test",
					version: "1.0.0",
				},
				agents: ["opencode"],
				scope: "project",
			}),
		);
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));
		} finally {
			console.log = origLog;
		}

		expect(logs.some((line) => line.includes("No updates needed"))).toBe(true);
		expect(logs.some((line) => line.includes("[funnel-builder]"))).toBe(true);
	});

	it("isolates per-bundle failures and exits non-zero", async () => {
		// Pre-install both bundles at v1.0.0 so `skill update` actually visits
		// both entries (the update path only acts on installed bundles).
		// Then the plugin entry for funnel-builder points at a bogus
		// sourceDir, forcing its install to fail at resolve time.
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);
		await withCwd(tmpDir, () =>
			installSkillBundle({
				sourceDir: FIXTURE_DIR_SECOND,
				agents: ["opencode"],
				version: "1.0.0",
				scope: "project",
			}),
		);

		const app = new Crust("update-isolation-host")
			.meta({ description: "test" })
			.handle(() => {})
			.extend(
				skillExtension({
					version: "1.0.0",
					autoUpdate: false,
					defaultScope: "project",
					customSkills: [
						{
							name: "funnel-builder",
							sourceDir: "/nonexistent/path/to/funnel-builder",
							version: "2.0.0",
						},
						{
							name: "pricing-toolkit",
							sourceDir: FIXTURE_DIR_SECOND,
							version: "2.0.0",
						},
					],
				}),
			);

		const warnings: string[] = [];
		const origLog = console.log;
		const origWarn = console.warn;
		console.log = () => {};
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		const origExitCode = process.exitCode;
		process.exitCode = 0;
		try {
			await withCwd(tmpDir, () => app.execute({ argv: ["skill", "update", "--scope", "project"] }));
		} finally {
			console.log = origLog;
			console.warn = origWarn;
		}

		const pricingDir = join(tmpDir, ".agents", "skills", "pricing-toolkit");
		// Second bundle updated despite first entry's failure.
		expect((await readInstalledManifest(pricingDir))?.version ?? null).toBe("2.0.0");
		// Failure was logged with the bundle name.
		expect(warnings.some((line) => line.includes("[funnel-builder]"))).toBe(true);
		// Non-zero exit so automation notices the partial failure.
		expect(process.exitCode).toBe(1);
		process.exitCode = origExitCode;
	});
});
