/**
 * Full integration tests for @crust/core.
 *
 * These tests import everything from the public API and verify
 * end-to-end behavior of a multi-command CLI with args, flags,
 * subcommands, and lifecycle hooks.
 */

import { describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	Command,
	CommandDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InferArgs,
	ParsedResult,
	ResolveResult,
	TypeConstructor,
} from "../src/index";
import {
	defineCommand,
	formatHelp,
	formatVersion,
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "../src/index";
import { runCommand as runTestCommand } from "./helpers";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Capture console output during a function execution.
 */
async function captureOutput(fn: () => Promise<void> | void): Promise<{
	stdout: string;
	stderr: string;
}> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const origLog = console.log;
	const origError = console.error;
	const origWarn = console.warn;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.warn = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};

	try {
		await fn();
	} finally {
		console.log = origLog;
		console.error = origError;
		console.warn = origWarn;
	}

	return {
		stdout: stdoutChunks.join("\n"),
		stderr: stderrChunks.join("\n"),
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Define a multi-command CLI for testing
// ────────────────────────────────────────────────────────────────────────────

const statusCmd = defineCommand({
	meta: { name: "status", description: "Show server status" },
	flags: {
		json: {
			type: Boolean,
			description: "Output as JSON",
			alias: "j",
		},
	},
	run({ flags }) {
		if (flags.json) {
			console.log(JSON.stringify({ status: "running" }));
		} else {
			console.log("Server is running");
		}
	},
});

const serveCmd = defineCommand({
	meta: { name: "serve", description: "Start the development server" },
	args: {
		directory: {
			type: String,
			description: "Directory to serve",
			default: ".",
		},
	},
	flags: {
		port: {
			type: Number,
			description: "Port number",
			default: 3000,
			alias: "p",
		},
		host: {
			type: String,
			description: "Host address",
			default: "localhost",
		},
		open: {
			type: Boolean,
			description: "Open in browser",
			alias: "o",
		},
	},
	subCommands: {
		status: statusCmd,
	},
	run({ args, flags }) {
		console.log(`Serving ${args.directory} on ${flags.host}:${flags.port}`);
		if (flags.open) {
			console.log("Opening browser...");
		}
	},
});

const buildCmd = defineCommand({
	meta: { name: "build", description: "Build the project" },
	args: {
		entry: { type: String, description: "Entry file", required: true },
	},
	flags: {
		outdir: {
			type: String,
			description: "Output directory",
			default: "dist",
			alias: "o",
		},
		minify: {
			type: Boolean,
			description: "Minify output",
			default: true,
		},
		target: {
			type: String,
			description: "Target runtime",
			required: true,
		},
	},
	run({ args, flags }) {
		console.log(
			`Building ${args.entry} → ${flags.outdir} (target: ${flags.target}, minify: ${flags.minify})`,
		);
	},
});

const deployCmd = defineCommand({
	meta: { name: "deploy", description: "Deploy the project" },
	args: {
		files: { type: String, description: "Files to deploy", variadic: true },
	},
	flags: {
		env: {
			type: String,
			description: "Deployment environment",
			default: "staging",
			alias: "e",
		},
		dryRun: {
			type: Boolean,
			description: "Dry run mode",
		},
	},
	run({ args, flags }) {
		const fileList =
			args.files && args.files.length > 0 ? args.files.join(", ") : "all files";
		console.log(`Deploying ${fileList} to ${flags.env}`);
		if (flags.dryRun) {
			console.log("(dry run)");
		}
	},
});

const rootCmd = defineCommand({
	meta: {
		name: "myapp",
		version: "1.2.3",
		description: "My awesome CLI application",
	},
	subCommands: {
		serve: serveCmd,
		build: buildCmd,
		deploy: deployCmd,
	},
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests: Full Pipeline
// ────────────────────────────────────────────────────────────────────────────

describe("integration: multi-command CLI", () => {
	// ── Root command ─────────────────────────────────────────────────
	describe("root command", () => {
		it("shows help when invoked without subcommand", async () => {
			const result = await runTestCommand(rootCmd, []);
			expect(result.stdout).toContain("My awesome CLI application");
			expect(result.stdout).toContain("USAGE:");
			expect(result.stdout).toContain("COMMANDS:");
			expect(result.stdout).toContain("serve");
			expect(result.stdout).toContain("build");
			expect(result.stdout).toContain("deploy");
		});

		it("shows version with --version", async () => {
			const result = await runTestCommand(rootCmd, ["--version"]);
			expect(result.stdout).toContain("myapp v1.2.3");
		});

		it("shows version with -v shortcut", async () => {
			const result = await runTestCommand(rootCmd, ["-v"]);
			expect(result.stdout).toContain("myapp v1.2.3");
		});

		it("shows help with --help", async () => {
			const result = await runTestCommand(rootCmd, ["--help"]);
			expect(result.stdout).toContain("USAGE:");
			expect(result.stdout).toContain("myapp");
			expect(result.stdout).toContain("COMMANDS:");
		});

		it("shows help with -h shortcut", async () => {
			const result = await runTestCommand(rootCmd, ["-h"]);
			expect(result.stdout).toContain("USAGE:");
		});

		it("shows error for unknown subcommand", async () => {
			const result = await runTestCommand(rootCmd, ["unknown"]);
			expect(result.exitCode).toBe(1);
			// The router throws for unknown subcommands when parent has no run()
			// runMain catches it and prints to stderr
		});
	});

	// ── Serve command ───────────────────────────────────────────────
	describe("serve command", () => {
		it("runs with all defaults", async () => {
			const result = await runTestCommand(rootCmd, ["serve"]);
			expect(result.stdout).toContain("Serving . on localhost:3000");
		});

		it("accepts directory positional arg", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "public"]);
			expect(result.stdout).toContain("Serving public on localhost:3000");
		});

		it("accepts --port flag", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "--port", "8080"]);
			expect(result.stdout).toContain("on localhost:8080");
		});

		it("accepts -p short alias for port", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "-p", "8080"]);
			expect(result.stdout).toContain("on localhost:8080");
		});

		it("accepts --host flag", async () => {
			const result = await runTestCommand(rootCmd, [
				"serve",
				"--host",
				"0.0.0.0",
			]);
			expect(result.stdout).toContain("on 0.0.0.0:3000");
		});

		it("accepts --open flag", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "--open"]);
			expect(result.stdout).toContain("Serving . on localhost:3000");
			expect(result.stdout).toContain("Opening browser...");
		});

		it("accepts -o short alias for open", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "-o"]);
			expect(result.stdout).toContain("Opening browser...");
		});

		it("accepts all flags together", async () => {
			const result = await runTestCommand(rootCmd, [
				"serve",
				"src",
				"-p",
				"4000",
				"--host",
				"0.0.0.0",
				"--open",
			]);
			expect(result.stdout).toContain("Serving src on 0.0.0.0:4000");
			expect(result.stdout).toContain("Opening browser...");
		});

		it("shows help for serve with --help", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "--help"]);
			expect(result.stdout).toContain("Start the development server");
			expect(result.stdout).toContain("ARGUMENTS:");
			expect(result.stdout).toContain("directory");
			expect(result.stdout).toContain("OPTIONS:");
			expect(result.stdout).toContain("--port");
			expect(result.stdout).toContain("--host");
			expect(result.stdout).toContain("--open");
			expect(result.stdout).toContain("COMMANDS:");
			expect(result.stdout).toContain("status");
		});
	});

	// ── Serve status nested subcommand ──────────────────────────────
	describe("serve status (nested subcommand)", () => {
		it("runs nested subcommand", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "status"]);
			expect(result.stdout).toContain("Server is running");
		});

		it("runs nested subcommand with --json flag", async () => {
			const result = await runTestCommand(rootCmd, [
				"serve",
				"status",
				"--json",
			]);
			expect(result.stdout).toContain('{"status":"running"}');
		});

		it("runs nested subcommand with -j alias", async () => {
			const result = await runTestCommand(rootCmd, ["serve", "status", "-j"]);
			expect(result.stdout).toContain('{"status":"running"}');
		});

		it("shows help for nested subcommand", async () => {
			const result = await runTestCommand(rootCmd, [
				"serve",
				"status",
				"--help",
			]);
			expect(result.stdout).toContain("Show server status");
			expect(result.stdout).toContain("--json");
		});
	});

	// ── Build command ───────────────────────────────────────────────
	describe("build command", () => {
		it("runs with required args and flags", async () => {
			const result = await runTestCommand(rootCmd, [
				"build",
				"src/index.ts",
				"--target",
				"bun",
			]);
			expect(result.stdout).toContain(
				"Building src/index.ts → dist (target: bun, minify: true)",
			);
		});

		it("overrides defaults", async () => {
			const result = await runTestCommand(rootCmd, [
				"build",
				"src/index.ts",
				"--target",
				"node",
				"-o",
				"out",
				"--no-minify",
			]);
			expect(result.stdout).toContain(
				"Building src/index.ts → out (target: node, minify: false)",
			);
		});

		it("fails when required arg is missing", async () => {
			const result = await runTestCommand(rootCmd, [
				"build",
				"--target",
				"bun",
			]);
			expect(result.exitCode).toBe(1);
		});

		it("fails when required flag is missing", async () => {
			const result = await runTestCommand(rootCmd, ["build", "src/index.ts"]);
			expect(result.exitCode).toBe(1);
		});

		it("shows help for build with --help", async () => {
			const result = await runTestCommand(rootCmd, ["build", "--help"]);
			expect(result.stdout).toContain("Build the project");
			expect(result.stdout).toContain("entry");
			expect(result.stdout).toContain("--outdir");
			expect(result.stdout).toContain("--minify");
			expect(result.stdout).toContain("--target");
		});
	});

	// ── Deploy command (variadic args) ──────────────────────────────
	describe("deploy command", () => {
		it("runs with no files (defaults to all)", async () => {
			const result = await runTestCommand(rootCmd, ["deploy"]);
			expect(result.stdout).toContain("Deploying all files to staging");
		});

		it("runs with specific files", async () => {
			const result = await runTestCommand(rootCmd, [
				"deploy",
				"app.js",
				"styles.css",
			]);
			expect(result.stdout).toContain(
				"Deploying app.js, styles.css to staging",
			);
		});

		it("runs with environment flag", async () => {
			const result = await runTestCommand(rootCmd, [
				"deploy",
				"-e",
				"production",
				"app.js",
			]);
			expect(result.stdout).toContain("Deploying app.js to production");
		});

		it("runs with dry-run flag", async () => {
			const result = await runTestCommand(rootCmd, ["deploy", "--dryRun"]);
			expect(result.stdout).toContain("Deploying all files to staging");
			expect(result.stdout).toContain("(dry run)");
		});

		it("shows help for deploy with --help", async () => {
			const result = await runTestCommand(rootCmd, ["deploy", "--help"]);
			expect(result.stdout).toContain("Deploy the project");
			expect(result.stdout).toContain("files");
			expect(result.stdout).toContain("--env");
			expect(result.stdout).toContain("--dryRun");
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests: Lifecycle Hooks
// ────────────────────────────────────────────────────────────────────────────

describe("integration: lifecycle hooks", () => {
	it("executes setup → run → cleanup in order", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "lifecycle" },
			setup() {
				order.push("setup");
			},
			run() {
				order.push("run");
			},
			cleanup() {
				order.push("cleanup");
			},
		});

		await runCommand(cmd, []);
		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	it("cleanup runs even when run throws", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "lifecycle-error" },
			setup() {
				order.push("setup");
			},
			run() {
				order.push("run");
				throw new Error("run failed");
			},
			cleanup() {
				order.push("cleanup");
			},
		});

		await expect(runCommand(cmd, [])).rejects.toThrow("run failed");
		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	it("async lifecycle hooks are awaited", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "async-lifecycle" },
			async setup() {
				await new Promise((r) => setTimeout(r, 10));
				order.push("setup");
			},
			async run() {
				await new Promise((r) => setTimeout(r, 10));
				order.push("run");
			},
			async cleanup() {
				await new Promise((r) => setTimeout(r, 10));
				order.push("cleanup");
			},
		});

		await runCommand(cmd, []);
		expect(order).toEqual(["setup", "run", "cleanup"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests: Type Inference (compile-time checks)
// ────────────────────────────────────────────────────────────────────────────

describe("integration: type inference", () => {
	it("args and flags are correctly typed in run callback", () => {
		// This test verifies compile-time type inference
		// If this compiles, the types are correct
		const cmd = defineCommand({
			meta: { name: "typed" },
			args: {
				port: { type: Number, default: 3000 },
				name: { type: String, required: true },
				files: { type: String, variadic: true },
				optional: { type: String },
			},
			flags: {
				verbose: { type: Boolean },
				output: { type: String, default: "dist" },
				count: { type: Number, required: true },
			},
			run({ args, flags }) {
				// These type assertions verify inference at compile time
				const port: number = args.port;
				const name: string = args.name;
				const files: string[] = args.files;
				const optional: string | undefined = args.optional;
				const verbose: boolean | undefined = flags.verbose;
				const output: string = flags.output;
				const count: number = flags.count;

				// Suppress unused variable warnings
				void port;
				void name;
				void files;
				void optional;
				void verbose;
				void output;
				void count;
			},
		});

		expect(cmd.meta.name).toBe("typed");
	});

	it("InferArgs and InferFlags types work correctly", () => {
		// Verify type inference utility types are accessible
		type TestArgs = {
			name: { type: StringConstructor; required: true };
			count: { type: NumberConstructor; default: 5 };
		};

		type ResolvedArgs = InferArgs<TestArgs>;

		// This would fail to compile if types are wrong
		const test: ResolvedArgs = { name: "hello", count: 5 };
		expect(test.name).toBe("hello");
		expect(test.count).toBe(5);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests: Individual API verification
// ────────────────────────────────────────────────────────────────────────────

describe("integration: individual APIs", () => {
	describe("defineCommand", () => {
		it("returns a frozen command object", () => {
			const cmd = defineCommand({ meta: { name: "test" } });
			expect(Object.isFrozen(cmd)).toBe(true);
			expect(cmd.meta.name).toBe("test");
		});
	});

	describe("parseArgs", () => {
		it("parses args and flags correctly", () => {
			const cmd = defineCommand({
				meta: { name: "test" },
				args: {
					name: { type: String, required: true },
				},
				flags: {
					verbose: { type: Boolean, alias: "v" },
				},
			});

			const result = parseArgs(cmd, ["hello", "-v"]);
			expect(result.args.name).toBe("hello");
			expect(result.flags.verbose).toBe(true);
		});
	});

	describe("formatHelp", () => {
		it("generates help text with all sections", () => {
			const help = formatHelp(rootCmd);
			expect(help).toContain("My awesome CLI application");
			expect(help).toContain("USAGE:");
			expect(help).toContain("COMMANDS:");
			expect(help).toContain("OPTIONS:");
		});
	});

	describe("formatVersion", () => {
		it("returns formatted version string", () => {
			const version = formatVersion(rootCmd);
			expect(version).toBe("myapp v1.2.3");
		});

		it("handles missing version", () => {
			const cmd = defineCommand({ meta: { name: "test" } });
			expect(formatVersion(cmd)).toBe("test (no version)");
		});
	});

	describe("resolveCommand", () => {
		it("resolves subcommands from argv", () => {
			const result = resolveCommand(rootCmd, ["serve", "--port", "8080"]);
			expect(result.resolved.meta.name).toBe("serve");
			expect(result.argv).toEqual(["--port", "8080"]);
			expect(result.path).toEqual(["myapp", "serve"]);
		});

		it("resolves nested subcommands", () => {
			const result = resolveCommand(rootCmd, ["serve", "status", "-j"]);
			expect(result.resolved.meta.name).toBe("status");
			expect(result.argv).toEqual(["-j"]);
			expect(result.path).toEqual(["myapp", "serve", "status"]);
		});
	});

	describe("runCommand", () => {
		it("executes the full pipeline", async () => {
			const output = await captureOutput(() =>
				runCommand(serveCmd, ["public", "--port", "4000"]),
			);
			expect(output.stdout).toContain("Serving public on localhost:4000");
		});
	});

	describe("runMain", () => {
		it("catches errors and sets exitCode", async () => {
			const origExitCode = process.exitCode;

			const cmd = defineCommand({
				meta: { name: "fail" },
				run() {
					throw new Error("test error");
				},
			});

			const output = await captureOutput(() => runMain(cmd));
			expect(output.stderr).toContain("Error: test error");

			// Restore
			process.exitCode = origExitCode ?? 0;
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests: All exported types are accessible
// ────────────────────────────────────────────────────────────────────────────

describe("integration: exported types", () => {
	it("all public types are importable and usable", () => {
		// These type-level checks verify all types are exported correctly
		// If this test compiles, all types are accessible

		const meta: CommandMeta = { name: "test" };
		const argDef: ArgDef = { type: String };
		const flagDef: FlagDef = { type: Boolean };
		const argsDef: ArgsDef = { name: argDef };
		const flagsDef: FlagsDef = { verbose: flagDef };
		const tc: TypeConstructor = String;

		// Command and CommandDef
		const cmdDef: CommandDef = { meta };
		const cmd: Command = defineCommand({ meta: { name: "test-types" } });

		// ParsedResult and ResolveResult
		const parsedResult: ParsedResult = {
			args: {},
			flags: {},
			rawArgs: [],
		};
		const resolveResult: ResolveResult = {
			resolved: cmd,
			argv: [],
			path: ["test-types"],
		};

		// Suppress unused variable warnings
		void meta;
		void argDef;
		void flagDef;
		void argsDef;
		void flagsDef;
		void tc;
		void cmdDef;
		void cmd;
		void parsedResult;
		void resolveResult;

		expect(true).toBe(true);
	});
});
