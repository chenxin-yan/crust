import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Crust } from "@crustjs/core";

import {
	buildCommand,
	generateCmdResolver,
	generateResolver,
	resolveEnvFilePaths,
	resolveOutfile,
} from "../../src/commands/build.ts";
import type { BunTarget } from "../../src/utils/build-helpers.ts";
import {
	getBinaryFilename,
	resolveBaseName,
	resolveBunBuildRunner,
	resolveTarget,
	SUPPORTED_TARGETS,
	TARGET_INFO,
} from "../../src/utils/build-helpers.ts";

describe("env file helpers", () => {
	const tmpDir = join(import.meta.dir, ".tmp-env-files");

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, ".env"), "PUBLIC_FOO=bar\n");
		writeFileSync(join(tmpDir, ".env.local"), "PUBLIC_BAR=baz\n");
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolves env-file paths relative to cwd", () => {
		expect(resolveEnvFilePaths(tmpDir, [".env", ".env.local"])).toEqual([
			join(tmpDir, ".env"),
			join(tmpDir, ".env.local"),
		]);
	});

	it("throws when an env-file is missing", () => {
		expect(() => resolveEnvFilePaths(tmpDir, [".env.missing"])).toThrow(/Env file not found/);
	});
});

describe("resolveBunBuildRunner", () => {
	it("prefers the real bun binary when available", () => {
		const originalWhich = Bun.which;
		(Bun as typeof Bun & { which: typeof Bun.which }).which = () => "/tmp/bun";

		try {
			const runner = resolveBunBuildRunner();
			expect(runner.command).toBe("/tmp/bun");
			expect(runner.env.BUN_BE_BUN).toBe(process.env.BUN_BE_BUN);
		} finally {
			(Bun as typeof Bun & { which: typeof Bun.which }).which = originalWhich;
		}
	});

	it("falls back to the current executable when bun is unavailable", () => {
		const originalWhich = Bun.which;
		(Bun as typeof Bun & { which: typeof Bun.which }).which = () => null;

		try {
			const runner = resolveBunBuildRunner();
			expect(runner.command).toBe(process.execPath);
			expect(runner.env.BUN_BE_BUN).toBe("1");
		} finally {
			(Bun as typeof Bun & { which: typeof Bun.which }).which = originalWhich;
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveTarget
// ────────────────────────────────────────────────────────────────────────────

describe("resolveTarget", () => {
	it("accepts full Bun target names directly", () => {
		for (const target of SUPPORTED_TARGETS) {
			expect(resolveTarget(target)).toBe(target);
		}
	});

	it("rejects every short alias with canonical-name guidance and a did-you-mean hint", () => {
		for (const target of SUPPORTED_TARGETS) {
			const alias = TARGET_INFO[target].alias;
			expect(() => resolveTarget(alias)).toThrow(
				`Unknown target "${alias}". Targets must use canonical Bun names. Did you mean "${target}"?`,
			);
			expect(() => resolveTarget(alias)).toThrow(/Valid targets: bun-linux-x64-baseline/);
		}
	});

	it("throws on unknown target", () => {
		expect(() => resolveTarget("linux-arm32")).toThrow(/Unknown target/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveBaseName
// ────────────────────────────────────────────────────────────────────────────

describe("resolveBaseName", () => {
	it("uses --name when provided", () => {
		expect(resolveBaseName("my-tool", "/test/src/cli.ts", "/test")).toBe("my-tool");
	});

	describe("with package.json", () => {
		const tmpDir = join(import.meta.dir, ".tmp-basename-test");

		beforeAll(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterAll(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("falls back to package.json name", () => {
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "my-cli-app" }));
			expect(resolveBaseName(undefined, join(tmpDir, "src/cli.ts"), tmpDir)).toBe("my-cli-app");
		});

		it("strips scope prefix from package.json name", () => {
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "@scope/my-cli" }));
			expect(resolveBaseName(undefined, join(tmpDir, "src/cli.ts"), tmpDir)).toBe("my-cli");
		});
	});

	it("falls back to entry filename", () => {
		expect(resolveBaseName(undefined, "/nonexistent/src/main.ts", "/nonexistent")).toBe("main");
	});

	it("strips file extension from entry filename", () => {
		expect(resolveBaseName(undefined, "/nonexistent/src/app.cli.ts", "/nonexistent")).toBe(
			"app.cli",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveOutfile
// ────────────────────────────────────────────────────────────────────────────

describe("resolveOutfile", () => {
	const cwd = "/test/project";
	const entry = "/test/project/src/cli.ts";

	it("uses --outfile when provided", () => {
		const result = resolveOutfile("./my-cli", undefined, entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "./my-cli"));
	});

	it("uses --name as dist/<name> when --outfile not provided", () => {
		const result = resolveOutfile(undefined, "my-tool", entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "dist", "my-tool"));
	});

	it("prefers --outfile over --name", () => {
		const result = resolveOutfile("./custom", "my-tool", entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "./custom"));
	});

	it("uses custom outdir when provided", () => {
		const result = resolveOutfile(undefined, "my-tool", entry, cwd, "out");
		expect(result).toBe(resolve(cwd, "out", "my-tool"));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for getBinaryFilename
// ────────────────────────────────────────────────────────────────────────────

describe("getBinaryFilename", () => {
	it("returns <name>-<target> for non-Windows targets", () => {
		expect(getBinaryFilename("my-cli", "bun-linux-x64-baseline")).toBe(
			"my-cli-bun-linux-x64-baseline",
		);
		expect(getBinaryFilename("my-cli", "bun-darwin-arm64")).toBe("my-cli-bun-darwin-arm64");
	});

	it("appends .exe for Windows targets", () => {
		expect(getBinaryFilename("my-cli", "bun-windows-x64-baseline")).toBe(
			"my-cli-bun-windows-x64-baseline.exe",
		);
		expect(getBinaryFilename("my-cli", "bun-windows-arm64")).toBe("my-cli-bun-windows-arm64.exe");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for generateResolver (shell script)
// ────────────────────────────────────────────────────────────────────────────

describe("generateResolver", () => {
	it("maps all Unix targets to correct uname keys", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("Linux-x86_64)");
		expect(content).toContain("Linux-aarch64)");
		expect(content).toContain("Darwin-x86_64)");
		expect(content).toContain("Darwin-arm64)");
	});

	it("excludes Windows targets from shell resolver", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).not.toContain("Windows");
		expect(content).not.toContain("bun-windows");
	});

	it("maps to correct binary filenames", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain('"my-cli-bun-linux-x64-baseline"');
		expect(content).toContain('"my-cli-bun-linux-arm64"');
		expect(content).toContain('"my-cli-bun-darwin-x64"');
		expect(content).toContain('"my-cli-bun-darwin-arm64"');
	});

	it("only includes targets that were built", () => {
		const subset: BunTarget[] = ["bun-linux-x64-baseline", "bun-darwin-arm64"];
		const content = generateResolver("my-cli", subset);
		expect(content).toContain("Linux-x86_64)");
		expect(content).toContain("Darwin-arm64)");
		// Should NOT contain platforms not in subset
		expect(content).not.toContain("Linux-aarch64)");
		expect(content).not.toContain("Darwin-x86_64)");
	});

	it("includes the base name in error messages", () => {
		const content = generateResolver("my-tool", SUPPORTED_TARGETS);
		expect(content).toContain("[my-tool]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for generateCmdResolver (Windows batch)
// ────────────────────────────────────────────────────────────────────────────

describe("generateCmdResolver", () => {
	it("references the correct Windows binary filename", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("my-cli-bun-windows-x64-baseline.exe");
		expect(content).toContain("my-cli-bun-windows-arm64.exe");
	});

	it("includes the base name in error messages", () => {
		const content = generateCmdResolver("my-tool", SUPPORTED_TARGETS);
		expect(content).toContain("[my-tool]");
	});

	it("generates error stub when no Windows targets built", () => {
		const unixOnly: BunTarget[] = ["bun-linux-x64-baseline", "bun-darwin-arm64"];
		const content = generateCmdResolver("my-cli", unixOnly);
		expect(content).toContain("No Windows binary was built");
	});

	it("uses CRLF line endings", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("\r\n");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Error handling tests
// ────────────────────────────────────────────────────────────────────────────

describe("buildCommand error handling", () => {
	it("sets exitCode and logs error when entry file is missing", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-missing-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		const errors: string[] = [];
		console.log = () => {};
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		};

		try {
			process.exitCode = 0;
			const app = new Crust("test").add(buildCommand);

			await app.execute({
				argv: ["build", "--entry", "nonexistent.ts", "--target", "bun-linux-x64-baseline"],
			});

			expect(process.exitCode).toBe(1);
			expect(errors.some((e) => /Entry file not found/.test(e))).toBe(true);
		} finally {
			process.exitCode = 0;
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("sets exitCode and logs error when --outfile used with default all-target build", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-outfile-default");
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		const errors: string[] = [];
		console.log = () => {};
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		};

		try {
			process.exitCode = 0;
			const app = new Crust("test").add(buildCommand);

			await app.execute({
				argv: ["build", "--outfile", "./out", "--no-validate"],
			});

			expect(process.exitCode).toBe(1);
			expect(errors.some((e) => /--outfile cannot be used/.test(e))).toBe(true);
		} finally {
			process.exitCode = 0;
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("writes Extension build artifacts beside an explicit --outfile", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-outfile-artifacts");
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`import { Crust, defineExtension } from "@crustjs/core";\n` +
				`const artifact = defineExtension("artifact", { build: ({ outDir }) => Bun.write(outDir + "/artifact.txt", "built") });\n` +
				`await new Crust("fixture").extend(artifact).action(() => {}).execute();\n`,
		);

		process.cwd = () => tmpDir;
		const originalLog = console.log;
		console.log = () => {};

		try {
			process.exitCode = 0;
			const app = new Crust("test").add(buildCommand);
			await app.execute({
				argv: [
					"build",
					"--entry",
					"src/cli.ts",
					"--target",
					"bun-darwin-arm64",
					"--outfile",
					"./out/custom/cli",
				],
			});

			expect(process.exitCode).toBe(0);
			expect(readFileSync(join(tmpDir, "out", "custom", "artifact.txt"), "utf-8")).toBe("built");
		} finally {
			process.exitCode = 0;
			process.cwd = originalCwd;
			console.log = originalLog;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	}, 30_000);
});
