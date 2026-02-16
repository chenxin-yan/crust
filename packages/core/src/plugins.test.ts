import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defineCommand } from "./command.ts";
import { autoCompletePlugin } from "./plugins/autocomplete.ts";
import { helpPlugin } from "./plugins/help.ts";
import { versionPlugin } from "./plugins/version.ts";
import { runCommand } from "./run.ts";

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	process.exitCode = 0;
});

function getStdout() {
	return stdoutChunks.join("\n");
}

function getStderr() {
	return stderrChunks.join("\n");
}

describe("built-in plugins", () => {
	it("help plugin renders generated help for no-run command", async () => {
		const cmd = defineCommand({
			meta: { name: "app", description: "Test app" },
			subCommands: {
				build: defineCommand({
					meta: { name: "build", description: "Build output" },
					run() {},
				}),
			},
		});

		await runCommand(cmd, {
			argv: ["--help"],
			plugins: [helpPlugin()],
		});

		const output = getStdout();
		expect(output).toContain("app - Test app");
		expect(output).toContain("USAGE:");
		expect(output).toContain("COMMANDS:");
		expect(output).toContain("build");
	});

	it("help plugin ignores help-like args after --", async () => {
		let capturedRawArgs: string[] = [];

		const cmd = defineCommand({
			meta: { name: "app", description: "Test app" },
			subCommands: {
				build: defineCommand({
					meta: { name: "build", description: "Build output" },
					run(ctx) {
						capturedRawArgs = [...ctx.rawArgs];
					},
				}),
			},
		});

		await runCommand(cmd, {
			argv: ["build", "--", "--help"],
			plugins: [helpPlugin()],
		});

		expect(getStdout()).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("version plugin handles --version", async () => {
		const cmd = defineCommand({
			meta: { name: "app" },
			run() {},
		});

		await runCommand(cmd, {
			argv: ["--version"],
			plugins: [versionPlugin("1.2.3")],
		});

		expect(getStdout()).toContain("app v1.2.3");
	});

	it("version plugin handles -v alias", async () => {
		const cmd = defineCommand({
			meta: { name: "app" },
			run() {},
		});

		await runCommand(cmd, {
			argv: ["-v"],
			plugins: [versionPlugin("2.0.0")],
		});

		expect(getStdout()).toContain("app v2.0.0");
	});

	it("version plugin ignores --version after -- separator", async () => {
		let ran = false;

		const cmd = defineCommand({
			meta: { name: "app" },
			run() {
				ran = true;
			},
		});

		await runCommand(cmd, {
			argv: ["--", "--version"],
			plugins: [versionPlugin("1.0.0")],
		});

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin only triggers on root command", async () => {
		let ran = false;

		const cmd = defineCommand({
			meta: { name: "app" },
			subCommands: {
				build: defineCommand({
					meta: { name: "build" },
					run() {
						ran = true;
					},
				}),
			},
		});

		// Running a subcommand without --version should not trigger version output
		await runCommand(cmd, {
			argv: ["build"],
			plugins: [versionPlugin("1.0.0")],
		});

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin flag appears in help output", async () => {
		const cmd = defineCommand({
			meta: { name: "app", description: "Test app" },
			run() {},
		});

		await runCommand(cmd, {
			argv: ["--help"],
			plugins: [versionPlugin("1.0.0"), helpPlugin()],
		});

		const output = getStdout();
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version plugin with function value", async () => {
		const cmd = defineCommand({
			meta: { name: "app" },
			run() {},
		});

		await runCommand(cmd, {
			argv: ["--version"],
			plugins: [versionPlugin(() => "3.5.0")],
		});

		expect(getStdout()).toContain("app v3.5.0");
	});

	it("autocomplete plugin handles command not found in error mode", async () => {
		const cmd = defineCommand({
			meta: { name: "app" },
			subCommands: {
				build: defineCommand({
					meta: { name: "build" },
					run() {},
				}),
			},
		});

		await runCommand(cmd, {
			argv: ["buld"],
			plugins: [autoCompletePlugin()],
		});

		expect(getStderr()).toContain('Unknown command "buld"');
		expect(getStderr()).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});
});
