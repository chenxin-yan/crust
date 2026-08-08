import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import { completionExtension } from "./index.ts";

let stdoutBuf: Buffer[];
let processStdoutBuf: Buffer[];
let stderrChunks: string[];
let originalWrite: typeof process.stdout.write;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
	stdoutBuf = [];
	processStdoutBuf = [];
	stderrChunks = [];
	originalWrite = process.stdout.write.bind(process.stdout);
	originalLog = console.log;
	originalError = console.error;
	originalExitCode = process.exitCode;

	process.stdout.write = (chunk: unknown) => {
		if (typeof chunk === "string") {
			processStdoutBuf.push(Buffer.from(chunk, "utf8"));
		} else if (chunk instanceof Uint8Array) {
			processStdoutBuf.push(Buffer.from(chunk));
		}
		return true;
	};
	console.log = (...args: unknown[]) => {
		stdoutBuf.push(Buffer.from(`${args.map(String).join(" ")}\n`, "utf8"));
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((a) => String(a)).join(" "));
	};
});

afterEach(() => {
	process.stdout.write = originalWrite;
	console.log = originalLog;
	console.error = originalError;
	process.exitCode = originalExitCode ?? 0;
});

function getStdout(): string {
	return Buffer.concat(stdoutBuf).toString("utf8");
}

function getProcessStdout(): string {
	return Buffer.concat(processStdoutBuf).toString("utf8");
}

function buildCli() {
	return new Crust("mycli")
		.meta({ description: "Test CLI" })
		.extend(completionExtension({ version: "1.2.3" }))
		.add(
			defineCommand("build", (cmd) =>
				cmd
					.meta({ description: "Build artifact" })
					.flags({ name: "target", type: "string", choices: ["browser", "bun", "node"] })
					.handle(() => {}),
			),
			defineCommand("deploy", (cmd) =>
				cmd
					.meta({ description: "Deploy", aliases: ["dep"] })
					.add(
						defineCommand("prod", (sub) =>
							sub
								.meta({ description: "Production deploy" })
								.flags({
									name: "env",
									type: "string",
									choices: ["dev", "staging", "prod"],
								})
								.handle(() => {}),
						),
					)
					.handle(() => {}),
			),
		)
		.handle(() => {});
}

describe("completionExtension", () => {
	it("registers a `completion` subcommand on the root command (after setup)", async () => {
		const app = buildCli();
		const root = await app.snapshot();
		expect(Object.keys(root.subCommands)).toContain("completion");
		const completionNode = root.subCommands.completion;
		expect(completionNode?.meta.description).toBe("Generate shell tab-completion scripts");
	});

	it("exposes options: command name override", async () => {
		const app = new Crust("mycli")
			.extend(completionExtension({ command: "shell-completion" }))
			.handle(() => {});
		const root = await app.snapshot();
		expect(Object.keys(root.subCommands)).toContain("shell-completion");
	});

	it("`mycli completion bash` prints a bash script to stdout", async () => {
		const app = buildCli();
		await app.execute({ argv: ["completion", "bash"] });
		const out = getStdout();
		expect(out.startsWith("# completion script for mycli v1.2.3")).toBe(true);
		expect(out).toContain("complete -o default -F _mycli 'mycli'");
		// Choice values are validated to a safe character set and emitted
		// bare in the `compgen -W` wordlist.
		expect(out).toContain("browser bun node"); // build --target
		expect(out).toContain("dev staging prod"); // deploy prod --env
	});

	it("writes completion scripts through injected stdout", async () => {
		const app = buildCli();
		const output: string[] = [];

		await app.run(["completion", "bash"], { stdout: (text) => output.push(text) });

		expect(output.join("\n")).toStartWith("# completion script for mycli v1.2.3");
		expect(getProcessStdout()).toBe("");
	});

	it("`mycli completion zsh` prints a zsh script with #compdef header", async () => {
		const app = buildCli();
		await app.execute({ argv: ["completion", "zsh"] });
		const out = getStdout();
		expect(out.startsWith("#compdef mycli\n")).toBe(true);
		expect(out).toContain("_arguments -C");
		expect(out).toContain(":target:(browser bun node)");
	});

	it("`mycli completion fish` prints a fish script", async () => {
		const app = buildCli();
		await app.execute({ argv: ["completion", "fish"] });
		const out = getStdout();
		expect(out.startsWith("# completion script for mycli v1.2.3")).toBe(true);
		expect(out).toContain("complete -c 'mycli' -f");
		// We replaced the order-insensitive `__fish_seen_subcommand_from`
		// chain with a per-script helper that walks `commandline -opc`
		// left-to-right.
		expect(out).toContain("function __mycli_path_at_arg");
		expect(out).toContain("__mycli_path_at_arg");
	});

	it("rejects unsupported shell names with a clear stderr message", async () => {
		// `choices` enforcement is wired into the parser, so the parser
		// rejects unsupported shell names with a `CrustError("PARSE", …)`
		// before the run handler ever sees the value. The error message names
		// the offending value and the allowed set.
		const app = buildCli();
		await app.execute({ argv: ["completion", "powershell"] });
		const stderr = stderrChunks.join("\n");
		expect(stderr).toContain('Invalid value "powershell"');
		expect(stderr).toContain("bash");
		expect(stderr).toContain("zsh");
		expect(stderr).toContain("fish");
		expect(process.exitCode).toBe(1);
	});

	describe("--output-dir", () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = await mkdtemp(join(tmpdir(), "tp010-completion-"));
		});

		afterEach(async () => {
			await rm(tmpDir, { recursive: true, force: true });
		});

		it("writes all three shell files with canonical filenames", async () => {
			const app = buildCli();
			await app.execute({
				argv: ["completion", "bash", "--output-dir", tmpDir],
			});

			// Per spec: bash → `<bin>`, zsh → `_<bin>`, fish → `<bin>.fish`.
			const entries = (await readdir(tmpDir)).sort();
			expect(entries).toEqual(["_mycli", "mycli", "mycli.fish"]);

			const bash = await readFile(join(tmpDir, "mycli"), "utf8");
			expect(bash).toContain("# completion script for mycli v1.2.3");
			expect(bash).toContain("complete -o default -F _mycli 'mycli'");

			const zsh = await readFile(join(tmpDir, "_mycli"), "utf8");
			expect(zsh.startsWith("#compdef mycli\n")).toBe(true);

			const fish = await readFile(join(tmpDir, "mycli.fish"), "utf8");
			expect(fish).toContain("complete -c 'mycli' -f");
		});

		it("writes nothing to stdout in --output-dir mode", async () => {
			const app = buildCli();
			await app.execute({
				argv: ["completion", "fish", "--output-dir", tmpDir],
			});
			expect(getStdout()).toBe("");
		});

		it("creates the output directory if it does not exist", async () => {
			const nested = join(tmpDir, "nested", "completions");
			const app = buildCli();
			await app.execute({
				argv: ["completion", "bash", "--output-dir", nested],
			});
			const entries = (await readdir(nested)).sort();
			expect(entries).toEqual(["_mycli", "mycli", "mycli.fish"]);
		});

		it("respects the `shells` option to limit which files are written", async () => {
			const app = new Crust("tinycli")
				.extend(
					completionExtension({
						version: "0.1.0",
						shells: ["bash", "zsh"],
					}),
				)
				.handle(() => {});
			await app.execute({
				argv: ["completion", "bash", "--output-dir", tmpDir],
			});
			const entries = (await readdir(tmpDir)).sort();
			expect(entries).toEqual(["_tinycli", "tinycli"]);
		});
	});
});
