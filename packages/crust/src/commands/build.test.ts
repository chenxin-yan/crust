import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, runCommand } from "@crustjs/core";
import type { BunTarget } from "../../src/commands/build.ts";
import {
	buildCommand,
	generateCmdResolver,
	generateResolver,
	getBinaryFilename,
	resolveBaseName,
	resolveOutfile,
	resolveTarget,
	resolveTargetOutfile,
	SUPPORTED_TARGETS,
	TARGET_ALIASES,
	TARGET_PLATFORM_MAP,
	TARGET_UNAME_MAP,
} from "../../src/commands/build.ts";

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for buildCommand definition
// ────────────────────────────────────────────────────────────────────────────

describe("buildCommand definition", () => {
	it("has correct meta", () => {
		expect(buildCommand.meta.name).toBe("build");
		expect(buildCommand.meta.description).toBe(
			"Compile your CLI to a standalone executable",
		);
	});

	it("has correct default flag values", () => {
		const result = parseArgs(buildCommand, []);
		expect(result.flags.entry).toBe("src/cli.ts");
		expect(result.flags.minify).toBe(true);
		expect(result.flags.resolver).toBe("cli");
		expect(result.flags.outdir).toBe("dist");
		expect(result.flags.outfile).toBeUndefined();
		expect(result.flags.name).toBeUndefined();
		expect(result.flags.target).toBeUndefined();
	});

	it("defines --entry/-e flag as string", () => {
		const result = parseArgs(buildCommand, ["-e", "src/main.ts"]);
		expect(result.flags.entry).toBe("src/main.ts");
	});

	it("defines --outfile/-o flag as string", () => {
		const result = parseArgs(buildCommand, ["-o", "./my-cli"]);
		expect(result.flags.outfile).toBe("./my-cli");
	});

	it("defines --outdir/-d flag as string with default 'dist'", () => {
		const result = parseArgs(buildCommand, ["-d", "out"]);
		expect(result.flags.outdir).toBe("out");
	});

	it("defines --name/-n flag as string", () => {
		const result = parseArgs(buildCommand, ["-n", "my-tool"]);
		expect(result.flags.name).toBe("my-tool");
	});

	it("defines --minify flag as boolean with default true", () => {
		const result = parseArgs(buildCommand, []);
		expect(result.flags.minify).toBe(true);
	});

	it("supports --no-minify to disable minification", () => {
		const result = parseArgs(buildCommand, ["--no-minify"]);
		expect(result.flags.minify).toBe(false);
	});

	it("defines --target/-t as repeatable string flag", () => {
		const result = parseArgs(buildCommand, [
			"--target",
			"linux-x64",
			"--target",
			"darwin-arm64",
		]);
		expect(result.flags.target).toEqual(["linux-x64", "darwin-arm64"]);
	});

	it("supports -t alias for --target", () => {
		const result = parseArgs(buildCommand, ["-t", "linux-x64"]);
		expect(result.flags.target).toEqual(["linux-x64"]);
	});

	it("is a frozen command object", () => {
		expect(Object.isFrozen(buildCommand)).toBe(true);
	});

	it("has a run function", () => {
		expect(typeof buildCommand.run).toBe("function");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveTarget
// ────────────────────────────────────────────────────────────────────────────

describe("resolveTarget", () => {
	it("resolves short alias to full Bun target", () => {
		expect(resolveTarget("linux-x64")).toBe("bun-linux-x64-baseline");
		expect(resolveTarget("linux-arm64")).toBe("bun-linux-arm64");
		expect(resolveTarget("darwin-x64")).toBe("bun-darwin-x64");
		expect(resolveTarget("darwin-arm64")).toBe("bun-darwin-arm64");
		expect(resolveTarget("windows-x64")).toBe("bun-windows-x64-baseline");
	});

	it("accepts full Bun target names directly", () => {
		for (const target of SUPPORTED_TARGETS) {
			expect(resolveTarget(target)).toBe(target);
		}
	});

	it("throws on unknown target", () => {
		expect(() => resolveTarget("linux-arm32")).toThrow(/Unknown target/);
	});

	it("error message includes valid targets", () => {
		expect(() => resolveTarget("nope")).toThrow(/Valid targets/);
	});

	it("all aliases map to supported targets", () => {
		for (const [alias, target] of Object.entries(TARGET_ALIASES)) {
			expect(SUPPORTED_TARGETS).toContain(target);
			expect(resolveTarget(alias)).toBe(target);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveBaseName
// ────────────────────────────────────────────────────────────────────────────

describe("resolveBaseName", () => {
	it("uses --name when provided", () => {
		expect(resolveBaseName("my-tool", "/test/src/cli.ts", "/test")).toBe(
			"my-tool",
		);
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
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-cli-app" }),
			);
			expect(
				resolveBaseName(undefined, join(tmpDir, "src/cli.ts"), tmpDir),
			).toBe("my-cli-app");
		});

		it("strips scope prefix from package.json name", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "@scope/my-cli" }),
			);
			expect(
				resolveBaseName(undefined, join(tmpDir, "src/cli.ts"), tmpDir),
			).toBe("my-cli");
		});
	});

	it("falls back to entry filename", () => {
		expect(
			resolveBaseName(undefined, "/nonexistent/src/main.ts", "/nonexistent"),
		).toBe("main");
	});

	it("strips file extension from entry filename", () => {
		expect(
			resolveBaseName(undefined, "/nonexistent/src/app.cli.ts", "/nonexistent"),
		).toBe("app.cli");
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

	it("resolves --outfile relative to cwd", () => {
		const result = resolveOutfile("dist/output", undefined, entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "dist/output"));
	});

	it("uses --name as dist/<name> when --outfile not provided", () => {
		const result = resolveOutfile(undefined, "my-tool", entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "dist", "my-tool"));
	});

	it("prefers --outfile over --name", () => {
		const result = resolveOutfile("./custom", "my-tool", entry, cwd, "dist");
		expect(result).toBe(resolve(cwd, "./custom"));
	});

	describe("with package.json", () => {
		const tmpDir = join(import.meta.dir, ".tmp-resolve-test");

		beforeAll(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterAll(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("falls back to package.json name when no --outfile or --name", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-cli-app" }),
			);
			const result = resolveOutfile(
				undefined,
				undefined,
				join(tmpDir, "src/cli.ts"),
				tmpDir,
				"dist",
			);
			expect(result).toBe(resolve(tmpDir, "dist", "my-cli-app"));
		});

		it("strips scope prefix from package.json name", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "@scope/my-cli" }),
			);
			const result = resolveOutfile(
				undefined,
				undefined,
				join(tmpDir, "src/cli.ts"),
				tmpDir,
				"dist",
			);
			expect(result).toBe(resolve(tmpDir, "dist", "my-cli"));
		});
	});

	it("falls back to entry filename when no --outfile, --name, or package.json", () => {
		const noPackageCwd = "/nonexistent/path/for/test";
		const testEntry = "/nonexistent/path/for/test/src/main.ts";
		const result = resolveOutfile(
			undefined,
			undefined,
			testEntry,
			noPackageCwd,
			"dist",
		);
		expect(result).toBe(resolve(noPackageCwd, "dist", "main"));
	});

	it("strips file extension from entry filename", () => {
		const noPackageCwd = "/nonexistent/path/for/test";
		const testEntry = "/nonexistent/path/for/test/src/app.cli.ts";
		const result = resolveOutfile(
			undefined,
			undefined,
			testEntry,
			noPackageCwd,
			"dist",
		);
		expect(result).toBe(resolve(noPackageCwd, "dist", "app.cli"));
	});

	it("uses custom outdir when provided", () => {
		const result = resolveOutfile(undefined, "my-tool", entry, cwd, "out");
		expect(result).toBe(resolve(cwd, "out", "my-tool"));
	});

	it("ignores outdir when --outfile is provided", () => {
		const result = resolveOutfile("./custom", undefined, entry, cwd, "out");
		expect(result).toBe(resolve(cwd, "./custom"));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveTargetOutfile
// ────────────────────────────────────────────────────────────────────────────

describe("resolveTargetOutfile", () => {
	const cwd = "/test/project";

	it("produces dist/<name>-<target> for non-Windows targets", () => {
		expect(
			resolveTargetOutfile("my-cli", "bun-linux-x64-baseline", cwd, "dist"),
		).toBe(resolve(cwd, "dist", "my-cli-bun-linux-x64-baseline"));
	});

	it("produces dist/<name>-<target> for darwin targets", () => {
		expect(
			resolveTargetOutfile("my-cli", "bun-darwin-arm64", cwd, "dist"),
		).toBe(resolve(cwd, "dist", "my-cli-bun-darwin-arm64"));
	});

	it("appends .exe for Windows targets", () => {
		expect(
			resolveTargetOutfile("my-cli", "bun-windows-x64-baseline", cwd, "dist"),
		).toBe(resolve(cwd, "dist", "my-cli-bun-windows-x64-baseline.exe"));
	});

	it("works with scoped-stripped names", () => {
		expect(
			resolveTargetOutfile("my-tool", "bun-linux-arm64", cwd, "dist"),
		).toBe(resolve(cwd, "dist", "my-tool-bun-linux-arm64"));
	});

	it("uses custom outdir when provided", () => {
		expect(
			resolveTargetOutfile("my-cli", "bun-linux-x64-baseline", cwd, "out"),
		).toBe(resolve(cwd, "out", "my-cli-bun-linux-x64-baseline"));
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
		expect(getBinaryFilename("my-cli", "bun-darwin-arm64")).toBe(
			"my-cli-bun-darwin-arm64",
		);
	});

	it("appends .exe for Windows targets", () => {
		expect(getBinaryFilename("my-cli", "bun-windows-x64-baseline")).toBe(
			"my-cli-bun-windows-x64-baseline.exe",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for generateResolver (shell script)
// ────────────────────────────────────────────────────────────────────────────

describe("generateResolver", () => {
	it("includes bash shebang", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content.startsWith("#!/usr/bin/env bash\n")).toBe(true);
	});

	it("detects platform using uname", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("uname -s");
		expect(content).toContain("uname -m");
	});

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

	it("uses exec to replace shell process with binary", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain('exec "$bin_path" "$@"');
	});

	it("includes chmod logic for execute permissions", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("chmod +x");
	});

	it("has a wildcard case for unsupported platforms", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("*)");
		expect(content).toContain("Unsupported platform");
	});

	it("checks binary file exists before exec", () => {
		const content = generateResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain('[ ! -f "$bin_path" ]');
		expect(content).toContain("Try reinstalling the package");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for generateCmdResolver (Windows batch)
// ────────────────────────────────────────────────────────────────────────────

describe("generateCmdResolver", () => {
	it("generates a batch script with @echo off", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toStartWith("@echo off");
	});

	it("references the correct Windows binary filename", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("my-cli-bun-windows-x64-baseline.exe");
	});

	it("passes all arguments to the binary", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("%*");
	});

	it("checks binary exists before running", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain('if not exist "%bin_path%"');
	});

	it("includes the base name in error messages", () => {
		const content = generateCmdResolver("my-tool", SUPPORTED_TARGETS);
		expect(content).toContain("[my-tool]");
	});

	it("generates error stub when no Windows targets built", () => {
		const unixOnly: BunTarget[] = [
			"bun-linux-x64-baseline",
			"bun-darwin-arm64",
		];
		const content = generateCmdResolver("my-cli", unixOnly);
		expect(content).toContain("No Windows binary was built");
	});

	it("uses CRLF line endings", () => {
		const content = generateCmdResolver("my-cli", SUPPORTED_TARGETS);
		expect(content).toContain("\r\n");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for TARGET_UNAME_MAP
// ────────────────────────────────────────────────────────────────────────────

describe("TARGET_UNAME_MAP", () => {
	it("maps every supported target", () => {
		for (const target of SUPPORTED_TARGETS) {
			expect(TARGET_UNAME_MAP[target]).toBeDefined();
		}
	});

	it("uses uname -s / uname -m format", () => {
		expect(TARGET_UNAME_MAP["bun-linux-x64-baseline"]).toBe("Linux-x86_64");
		expect(TARGET_UNAME_MAP["bun-linux-arm64"]).toBe("Linux-aarch64");
		expect(TARGET_UNAME_MAP["bun-darwin-x64"]).toBe("Darwin-x86_64");
		expect(TARGET_UNAME_MAP["bun-darwin-arm64"]).toBe("Darwin-arm64");
		expect(TARGET_UNAME_MAP["bun-windows-x64-baseline"]).toBe("Windows-x64");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Error handling tests
// ────────────────────────────────────────────────────────────────────────────

describe("buildCommand error handling", () => {
	it("throws descriptive error when entry file is missing", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-missing-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, {
					argv: ["--entry", "nonexistent.ts", "--target", "linux-x64"],
				}),
			).rejects.toThrow(/Entry file not found/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("error message includes the resolved path", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-error-path");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, {
					argv: ["--entry", "nonexistent.ts", "--target", "linux-x64"],
				}),
			).rejects.toThrow(resolve(tmpDir, "nonexistent.ts"));
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("error message suggests --entry flag", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-suggest-entry");
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, {
					argv: ["--entry", "nonexistent.ts", "--target", "linux-x64"],
				}),
			).rejects.toThrow(/--entry/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws when --outfile used with default all-target build", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-outfile-default");
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, {
					argv: ["--outfile", "./out"],
				}),
			).rejects.toThrow(/--outfile cannot be used/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("throws when --outfile used with multiple --target flags", async () => {
		const originalCwd = process.cwd;
		const tmpDir = join(import.meta.dir, ".tmp-outfile-multi");
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");

		process.cwd = () => tmpDir;

		const originalLog = console.log;
		const originalError = console.error;
		console.log = () => {};
		console.error = () => {};

		try {
			await expect(
				runCommand(buildCommand, {
					argv: [
						"--outfile",
						"./out",
						"--target",
						"linux-x64",
						"--target",
						"darwin-arm64",
					],
				}),
			).rejects.toThrow(/--outfile cannot be used/);
		} finally {
			process.cwd = originalCwd;
			console.log = originalLog;
			console.error = originalError;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// SUPPORTED_TARGETS constant
// ────────────────────────────────────────────────────────────────────────────

describe("SUPPORTED_TARGETS", () => {
	it("contains 5 targets", () => {
		expect(SUPPORTED_TARGETS).toHaveLength(5);
	});

	it("includes linux, darwin, and windows", () => {
		expect(SUPPORTED_TARGETS.some((t) => t.includes("linux"))).toBe(true);
		expect(SUPPORTED_TARGETS.some((t) => t.includes("darwin"))).toBe(true);
		expect(SUPPORTED_TARGETS.some((t) => t.includes("windows"))).toBe(true);
	});

	it("includes x64 and arm64 architectures", () => {
		expect(SUPPORTED_TARGETS.some((t) => t.includes("x64"))).toBe(true);
		expect(SUPPORTED_TARGETS.some((t) => t.includes("arm64"))).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// TARGET_PLATFORM_MAP constant
// ────────────────────────────────────────────────────────────────────────────

describe("TARGET_PLATFORM_MAP", () => {
	it("maps every supported target", () => {
		for (const target of SUPPORTED_TARGETS) {
			expect(TARGET_PLATFORM_MAP[target]).toBeDefined();
		}
	});

	it("uses process.platform-process.arch format", () => {
		expect(TARGET_PLATFORM_MAP["bun-linux-x64-baseline"]).toBe("linux-x64");
		expect(TARGET_PLATFORM_MAP["bun-linux-arm64"]).toBe("linux-arm64");
		expect(TARGET_PLATFORM_MAP["bun-darwin-x64"]).toBe("darwin-x64");
		expect(TARGET_PLATFORM_MAP["bun-darwin-arm64"]).toBe("darwin-arm64");
		expect(TARGET_PLATFORM_MAP["bun-windows-x64-baseline"]).toBe("win32-x64");
	});
});
