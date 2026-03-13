import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { completeArg, completeFlag, completionPlugin } from "./completion.ts";
import { helpPlugin } from "./help.ts";

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

function createApp() {
	return new Crust("app")
		.flags({
			verbose: {
				type: "boolean",
				short: "v",
				description: "Enable verbose logs",
				inherit: true,
			},
			output: completeFlag(
				{
					type: "string",
					description: "Output format",
					short: "o",
					aliases: ["out"],
					inherit: true,
				},
				["json", "yaml"],
			),
			broken: completeFlag(
				{
					type: "string",
					description: "Broken provider",
				},
				async () => {
					throw new Error("boom");
				},
			),
		})
		.command("build", (cmd) =>
			cmd
				.args([
					completeArg(
						{
							name: "env",
							type: "string",
							description: "Target environment",
						},
						["dev", "prod"],
					),
				] as const)
				.flags({
					target: completeFlag(
						{
							type: "string",
							description: "Build target",
							short: "t",
						},
						async () => ["client", "server"],
					),
				})
				.run(() => {}),
		)
		.use(completionPlugin())
		.use(helpPlugin())
		.run(() => {});
}

describe("completion plugin", () => {
	it("hides the internal completion command from help output", async () => {
		const app = createApp();

		await app.execute({ argv: ["completion", "--help"] });

		const output = getStdout();
		expect(output).toContain("Generate shell completion scripts");
		expect(output).toContain("bash");
		expect(output).toContain("zsh");
		expect(output).toContain("fish");
		expect(output).not.toContain("__complete");
		expect(getStderr()).toBe("");
	});

	it("prints a bash completion script", async () => {
		const app = createApp();

		await app.execute({ argv: ["completion", "bash"] });

		const output = getStdout();
		expect(output).toContain("complete -o bashdefault -o default");
		expect(output).toContain('"completion" __complete bash');
	});

	it("prints a zsh completion script", async () => {
		const app = createApp();

		await app.execute({ argv: ["completion", "zsh"] });

		const output = getStdout();
		expect(output).toContain("#compdef app");
		expect(output).toContain('"completion" __complete zsh');
	});

	it("prints a fish completion script", async () => {
		const app = createApp();

		await app.execute({ argv: ["completion", "fish"] });

		const output = getStdout();
		expect(output).toContain("complete -c app -f");
		expect(output).toContain("completion __complete fish");
	});

	it("suggests root subcommands through the internal backend", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"0",
				"--current",
				"b",
			],
		});

		expect(getStdout()).toContain("build");
	});

	it("suggests nested flags, aliases, and inherited flags", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"1",
				"--current=--",
				"--",
				"build",
			],
		});

		const output = getStdout();
		expect(output).toContain("--target");
		expect(output).toContain("-t");
		expect(output).toContain("--verbose");
		expect(output).toContain("--no-verbose");
		expect(output).toContain("--out");
	});

	it("suggests positional arg values from a static provider", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"1",
				"--current",
				"pr",
				"--",
				"build",
			],
		});

		expect(getStdout()).toContain("prod");
	});

	it("suggests flag values from async providers", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"2",
				"--current",
				"se",
				"--",
				"build",
				"--target",
			],
		});

		expect(getStdout()).toContain("server");
	});

	it("does not throw when a provider fails", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"1",
				"--current=",
				"--",
				"--broken",
			],
		});

		expect(getStdout()).toBe("");
		expect(getStderr()).toBe("");
	});

	it("does not suggest hidden internal commands while completing the public completion command", async () => {
		const app = createApp();

		await app.execute({
			argv: [
				"completion",
				"__complete",
				"bash",
				"--index",
				"1",
				"--current",
				"__",
				"--",
				"completion",
			],
		});

		expect(getStdout()).toBe("");
	});
});
