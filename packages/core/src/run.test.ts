import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defineCommand } from "../src/command.ts";
import { runCommand, runMain } from "../src/run.ts";
import type { CrustPlugin } from "./plugins.ts";

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
			args: [{ name: "name", type: "string", required: true }],
			flags: {
				verbose: { type: "boolean", alias: "v" },
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
			args: [{ name: "port", type: "number", default: 3000 }],
			flags: {
				host: { type: "string", default: "localhost" },
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

	it("provides the resolved command as command in context", async () => {
		let receivedCmd: unknown;

		const cmd = defineCommand({
			meta: { name: "test" },
			run({ command }) {
				receivedCmd = command;
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(receivedCmd).toBe(cmd);
	});

	// ── Lifecycle hooks ──────────────────────────────────────────────────

	it("calls preRun() before run()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			preRun() {
				order.push("preRun");
			},
			run() {
				order.push("run");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["preRun", "run"]);
	});

	it("calls postRun() after run()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			run() {
				order.push("run");
			},
			postRun() {
				order.push("postRun");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["run", "postRun"]);
	});

	it("calls full lifecycle: preRun → run → postRun", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			preRun() {
				order.push("preRun");
			},
			run() {
				order.push("run");
			},
			postRun() {
				order.push("postRun");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["preRun", "run", "postRun"]);
	});

	it("calls postRun() even when run() throws", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			preRun() {
				order.push("preRun");
			},
			run() {
				order.push("run");
				throw new Error("run failed");
			},
			postRun() {
				order.push("postRun");
			},
		});

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow("run failed");

		expect(order).toEqual(["preRun", "run", "postRun"]);
	});

	it("calls postRun() even when preRun() throws", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			preRun() {
				order.push("preRun");
				throw new Error("preRun failed");
			},
			run() {
				order.push("run");
			},
			postRun() {
				order.push("postRun");
			},
		});

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow(
			"preRun failed",
		);

		// run() should NOT have been called since preRun() threw
		// but postRun() should still run
		expect(order).toEqual(["preRun", "postRun"]);
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

	it("awaits async preRun() and postRun()", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			async preRun() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push("preRun");
			},
			async run() {
				order.push("run");
			},
			async postRun() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push("postRun");
			},
		});

		await runCommand(cmd, { argv: [] });

		expect(order).toEqual(["preRun", "run", "postRun"]);
	});

	// ── Missing run() behavior ──────────────────────────────────────────

	it("missing run() without plugins is silent noop", async () => {
		const cmd = defineCommand({
			meta: { name: "test", description: "No-run command" },
		});

		await runCommand(cmd, { argv: [] });

		expect(getStdout()).toBe("");
	});

	it("runs setup and middleware in order", async () => {
		const observed: string[] = [];

		const cmd = defineCommand({
			meta: { name: "app" },
			run() {
				observed.push("run");
			},
		});

		const plugin: CrustPlugin = {
			name: "lifecycle-plugin",
			setup() {
				observed.push("setup");
			},
			async middleware(_context, next) {
				observed.push("middleware:before");
				await next();
				observed.push("middleware:after");
			},
		};

		await runCommand(cmd, {
			argv: [],
			plugins: [plugin],
		});

		expect(observed).toEqual([
			"setup",
			"middleware:before",
			"run",
			"middleware:after",
		]);
	});

	it("short-circuits when middleware does not call next", async () => {
		let didRun = false;

		const cmd = defineCommand({
			meta: { name: "app" },
			run() {
				didRun = true;
			},
		});

		const plugin: CrustPlugin = {
			name: "short-circuit-plugin",
			async middleware() {
				return;
			},
		};

		await runCommand(cmd, {
			argv: [],
			plugins: [plugin],
		});

		expect(didRun).toBe(false);
	});

	// ── Subcommand routing ──────────────────────────────────────────────

	it("routes to subcommand and executes it", async () => {
		let subRan = false;

		const subCmd = defineCommand({
			meta: { name: "build" },
			flags: {
				minify: { type: "boolean" },
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
			args: [{ name: "name", type: "string", required: true }],
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

	it("propagates missing required arg errors", async () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
			run() {},
		});

		await expect(runCommand(cmd, { argv: [] })).rejects.toThrow(
			'Missing required argument "<file>"',
		);
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
				args: [{ name: "name", type: "string", required: true }],
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
