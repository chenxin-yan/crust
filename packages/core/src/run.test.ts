import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defineCommand } from "../src/command.ts";
import { runCommand, runMain } from "../src/run.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — capture console output
// ────────────────────────────────────────────────────────────────────────────

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalWarn: typeof console.warn;

beforeEach(() => {
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;
	originalWarn = console.warn;

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
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	console.warn = originalWarn;
});

function getStdout(): string {
	return stdoutChunks.join("\n");
}

function getStderr(): string {
	return stderrChunks.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// runCommand — basic execution
// ────────────────────────────────────────────────────────────────────────────

describe("runCommand", () => {
	it("executes run() with parsed context", async () => {
		let receivedArgs: Record<string, unknown> = {};
		let receivedFlags: Record<string, unknown> = {};

		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "name", type: String, required: true }],
			flags: {
				verbose: { type: Boolean, alias: "v" },
			},
			run({ args, flags }) {
				receivedArgs = args as unknown as Record<string, unknown>;
				receivedFlags = flags as unknown as Record<string, unknown>;
			},
		});

		await runCommand(cmd, { argv: ["hello", "--verbose"] });

		expect(receivedArgs.name).toBe("hello");
		expect(receivedFlags.verbose).toBe(true);
	});

	it("executes run() with default values", async () => {
		let receivedArgs: Record<string, unknown> = {};
		let receivedFlags: Record<string, unknown> = {};

		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "port", type: Number, default: 3000 }],
			flags: {
				host: { type: String, default: "localhost" },
			},
			run({ args, flags }) {
				receivedArgs = args as unknown as Record<string, unknown>;
				receivedFlags = flags as unknown as Record<string, unknown>;
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(receivedArgs.port).toBe(3000);
		expect(receivedFlags.host).toBe("localhost");
	});

	it("provides rawArgs from -- separator", async () => {
		let receivedRawArgs: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			run({ rawArgs }) {
				receivedRawArgs = rawArgs;
			},
		});

		await runCommand(cmd, { argv: ["--", "foo", "bar"] });

		expect(receivedRawArgs).toEqual(["foo", "bar"]);
	});

	it("provides the resolved command as cmd in context", async () => {
		let receivedCmd: unknown;

		const cmd = defineCommand({
			meta: { name: "test" },
			run({ cmd }) {
				receivedCmd = cmd;
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(receivedCmd).toBe(cmd);
	});

	// ── Lifecycle hooks ──────────────────────────────────────────────────

	it("calls setup() before run()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			setup() {
				order.push("setup");
			},
			run() {
				order.push("run");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["setup", "run"]);
	});

	it("calls cleanup() after run()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			run() {
				order.push("run");
			},
			cleanup() {
				order.push("cleanup");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["run", "cleanup"]);
	});

	it("calls full lifecycle: setup → run → cleanup", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
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

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	it("calls cleanup() even when run() throws", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
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

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow("run failed");

		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	it("calls cleanup() even when setup() throws", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			setup() {
				order.push("setup");
				throw new Error("setup failed");
			},
			run() {
				order.push("run");
			},
			cleanup() {
				order.push("cleanup");
			},
		});

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow("setup failed");

		// run() should NOT have been called since setup() threw
		// but cleanup() should still run
		expect(order).toEqual(["setup", "cleanup"]);
	});

	// ── Async support ───────────────────────────────────────────────────

	it("awaits async run()", async () => {
		let completed = false;

		const cmd = defineCommand({
			meta: { name: "test" },
			async run() {
				await new Promise((resolve) => setTimeout(resolve, 10));
				completed = true;
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(completed).toBe(true);
	});

	it("awaits async setup() and cleanup()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			async setup() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push("setup");
			},
			async run() {
				order.push("run");
			},
			async cleanup() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push("cleanup");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	// ── Missing run() behavior ─────────────────────────────────────────-

	// ── Missing run() behavior ──────────────────────────────────────────

	it("missing run() without plugins is silent noop", async () => {
		const cmd = defineCommand({
			meta: { name: "test", description: "No-run command" },
		});

		await runCommand(cmd, { argv: [] });

		expect(getStdout()).toBe("");
	});

	it("parses global flags before routing", async () => {
		let receivedCmd = "";
		let receivedGlobalFlags: Record<string, unknown> = {};

		const subCmd = defineCommand({
			meta: { name: "build" },
			run({ cmd, globalFlags }) {
				receivedCmd = cmd.meta.name;
				receivedGlobalFlags = globalFlags;
			},
		});

		const rootCmd = defineCommand({
			meta: { name: "cli" },
			subCommands: { build: subCmd },
		});

		await runCommand(rootCmd, {
			argv: ["--cwd", "./app", "build"],
			globalFlags: {
				cwd: { type: String },
			},
		});

		expect(receivedCmd).toBe("build");
		expect(receivedGlobalFlags.cwd).toBe("./app");
	});

	// ── Subcommand routing ──────────────────────────────────────────────

	it("routes to subcommand and executes it", async () => {
		let subRan = false;

		const subCmd = defineCommand({
			meta: { name: "build" },
			flags: {
				minify: { type: Boolean },
			},
			run({ flags }) {
				subRan = true;
				console.log(`minify: ${flags.minify}`);
			},
		});

		const rootCmd = defineCommand({
			meta: { name: "cli" },
			subCommands: { build: subCmd },
		});

		await runCommand(rootCmd, { argv: ["build", "--minify"] });

		expect(subRan).toBe(true);
		expect(getStdout()).toContain("minify: true");
	});

	it("routes to deeply nested subcommand", async () => {
		let deepRan = false;

		const deepCmd = defineCommand({
			meta: { name: "component" },
			args: [{ name: "name", type: String, required: true }],
			run({ args }) {
				deepRan = true;
				console.log(`generate component: ${args.name}`);
			},
		});

		const genCmd = defineCommand({
			meta: { name: "generate" },
			subCommands: { component: deepCmd },
		});

		const rootCmd = defineCommand({
			meta: { name: "cli" },
			subCommands: { generate: genCmd },
		});

		await runCommand(rootCmd, {
			argv: ["generate", "component", "Button"],
		});

		expect(deepRan).toBe(true);
		expect(getStdout()).toContain("generate component: Button");
	});

	// ── Error propagation ───────────────────────────────────────────────

	it("propagates parsing errors", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			run() {},
		});

		await expect(runCommand(cmd, { argv: ["--unknown-flag"] })).rejects.toThrow(
			"Unknown flag",
		);
	});

	it("throws on global/local flag name collision", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: Boolean },
			},
			run() {},
		});

		await expect(
			runCommand(cmd, {
				argv: [],
				globalFlags: {
					verbose: { type: Boolean },
				},
			}),
		).rejects.toThrow('Global/local flag collision on command "test"');
	});

	it("throws on global alias collision with local flag name", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				cwd: { type: String },
			},
			run() {},
		});

		await expect(
			runCommand(cmd, {
				argv: [],
				globalFlags: {
					config: { type: String, alias: "cwd" },
				},
			}),
		).rejects.toThrow('Global/local flag collision on command "test"');
	});

	it("propagates missing required arg errors", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: String, required: true }],
			run() {},
		});

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow(
			'Missing required argument "<file>"',
		);
	});

	it("still validates required global flags before command run", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			run() {},
		});

		await expect(
			runCommand(cmd, {
				argv: [],
				globalFlags: {
					cwd: { type: String, required: true },
				},
			}),
		).rejects.toThrow('Missing required flag "--cwd"');
	});

	it("propagates unknown subcommand errors", async () => {
		const subCmd = defineCommand({
			meta: { name: "build" },
			run() {},
		});

		const rootCmd = defineCommand({
			meta: { name: "cli" },
			subCommands: { build: subCmd },
		});

		await expect(runCommand(rootCmd, { argv: ["bild"] })).rejects.toThrow(
			'Unknown command "bild"',
		);
	});

	// ── argv defaults ───────────────────────────────────────────────────

	it("defaults to process.argv.slice(2) when options not provided", async () => {
		// Save original process.argv
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts", "hello"];
			let receivedName = "";

			const cmd = defineCommand({
				meta: { name: "test" },
				args: [{ name: "name", type: String, required: true }],
				run({ args }) {
					receivedName = args.name as string;
				},
			});

			await runCommand(cmd);

			expect(receivedName).toBe("hello");
		} finally {
			process.argv = originalArgv;
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// runMain — top-level error handling
// ────────────────────────────────────────────────────────────────────────────

describe("runMain", () => {
	it("catches errors and sets exitCode", async () => {
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts", "--unknown-flag"];

			const cmd = defineCommand({
				meta: { name: "test" },
				run() {},
			});

			await runMain(cmd);

			expect(process.exitCode).toBe(1);
			expect(getStderr()).toContain("Error:");
			expect(getStderr()).toContain("Unknown flag");
		} finally {
			process.argv = originalArgv;
			process.exitCode = 0;
		}
	});

	it("catches async errors from run()", async () => {
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts"];

			const cmd = defineCommand({
				meta: { name: "test" },
				async run() {
					throw new Error("async failure");
				},
			});

			await runMain(cmd);

			expect(process.exitCode).toBe(1);
			expect(getStderr()).toContain("Error: async failure");
		} finally {
			process.argv = originalArgv;
			process.exitCode = 0;
		}
	});

	it("catches sync throws from run()", async () => {
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts"];

			const cmd = defineCommand({
				meta: { name: "test" },
				run() {
					throw new Error("sync failure");
				},
			});

			await runMain(cmd);

			expect(process.exitCode).toBe(1);
			expect(getStderr()).toContain("Error: sync failure");
		} finally {
			process.argv = originalArgv;
			process.exitCode = 0;
		}
	});

	it("catches unknown subcommand errors", async () => {
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts", "nonexistent"];

			const subCmd = defineCommand({
				meta: { name: "build" },
				run() {},
			});

			const cmd = defineCommand({
				meta: { name: "cli" },
				subCommands: { build: subCmd },
			});

			await runMain(cmd);

			expect(process.exitCode).toBe(1);
			expect(getStderr()).toContain('Unknown command "nonexistent"');
		} finally {
			process.argv = originalArgv;
			process.exitCode = 0;
		}
	});

	it("does not set exitCode on success", async () => {
		const originalArgv = process.argv;
		const exitCodeBefore = process.exitCode;

		try {
			process.argv = ["bun", "script.ts"];

			const cmd = defineCommand({
				meta: { name: "test" },
				run() {
					console.log("success");
				},
			});

			await runMain(cmd);

			// exitCode should not have changed from before
			expect(process.exitCode).toBe(exitCodeBefore);
			expect(getStdout()).toContain("success");
		} finally {
			process.argv = originalArgv;
		}
	});

	it("handles non-Error thrown values", async () => {
		const originalArgv = process.argv;

		try {
			process.argv = ["bun", "script.ts"];

			const cmd = defineCommand({
				meta: { name: "test" },
				run() {
					throw "string error";
				},
			});

			await runMain(cmd);

			expect(process.exitCode).toBe(1);
			expect(getStderr()).toContain("Error: string error");
		} finally {
			process.argv = originalArgv;
			process.exitCode = 0;
		}
	});

	it("missing run() without plugins is silent (no error)", async () => {
		const originalArgv = process.argv;
		const exitCodeBefore = process.exitCode;

		try {
			process.argv = ["bun", "script.ts"];

			const cmd = defineCommand({
				meta: { name: "test", description: "Help-only command" },
			});

			await runMain(cmd);

			// Silent noop is not an error — exitCode should not change
			expect(process.exitCode).toBe(exitCodeBefore);
		} finally {
			process.argv = originalArgv;
		}
	});
});
