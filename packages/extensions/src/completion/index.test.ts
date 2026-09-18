import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import {
	completion,
	type CompletionRenderOptions,
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from "../index.ts";

let stdoutBuf: Buffer[];
let processStdoutBuf: Buffer[];
let stderrChunks: string[];
let originalWrite: typeof process.stdout.write;
let originalLog: typeof console.log;
let originalError: typeof console.error;
let originalExitCode: typeof process.exitCode;

type StdoutChunk = Parameters<typeof process.stdout.write>[0];

function isStringChunk(chunk: StdoutChunk): chunk is string {
	return typeof chunk === "string";
}

beforeEach(() => {
	stdoutBuf = [];
	processStdoutBuf = [];
	stderrChunks = [];
	originalWrite = process.stdout.write.bind(process.stdout);
	originalLog = console.log;
	originalError = console.error;
	originalExitCode = process.exitCode;

	process.stdout.write = (chunk: StdoutChunk) => {
		if (isStringChunk(chunk)) {
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
	return new Crust("mycli", { description: "Test CLI", version: "1.2.3" })
		.extend(completion())
		.add(
			defineCommand("build", { description: "Build artifact" }, (cmd) =>
				cmd
					.flags({ name: "target", type: "string", choices: ["browser", "bun", "node"] })
					.action(() => {}),
			),
			defineCommand("deploy", { description: "Deploy", aliases: ["dep"] }, (cmd) =>
				cmd
					.add(
						defineCommand("prod", { description: "Production deploy" }, (sub) =>
							sub
								.flags({
									name: "env",
									type: "string",
									choices: ["dev", "staging", "prod"],
								})
								.action(() => {}),
						),
					)
					.action(() => {}),
			),
		)
		.action(() => {});
}

describe("completion", () => {
	it("exposes options: command name override", async () => {
		const app = new Crust("mycli")
			.extend(completion({ command: "shell-completion" }))
			.action(() => {});
		const root = await app.snapshot();
		expect(Object.keys(root.subCommands)).toContain("shell-completion");
	});

	it("uses the explicit version option as an override", async () => {
		const app = new Crust("mycli", { version: "1.2.3" })
			.extend(completion({ version: "2.0.0" }))
			.action(() => {});
		await app.execute({ argv: ["completion", "bash"] });
		expect(getStdout()).toStartWith("# completion script for mycli v2.0.0");
	});

	it("reports a missing version", async () => {
		const app = new Crust("mycli").extend(completion()).action(() => {});
		await app.execute({ argv: ["completion", "bash"] });
		expect(stderrChunks.join("\n")).toContain("completion extension requires a version");
		expect(process.exitCode).toBe(1);
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

		await app.execute({
			argv: ["completion", "bash"],
			io: { stdout: (text) => output.push(text) },
		});

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
	});

	it("rejects unsupported shell names with a clear stderr message", async () => {
		// `choices` enforcement is wired into the parser, so the parser
		// rejects unsupported shell names with a `CrustError("PARSE", …)`
		// before the action ever sees the value. The error message names
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

		it("preserves unrelated files in the user-owned output directory", async () => {
			await writeFile(join(tmpDir, "other-cli"), "existing completion");
			await buildCli().execute({
				argv: ["completion", "bash", "--output-dir", tmpDir],
			});
			expect(await readFile(join(tmpDir, "other-cli"), "utf8")).toBe("existing completion");
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
	});
});

describe("completion build hook", () => {
	const outDir = "/unused/out";
	const text = (content: string | Uint8Array) => Buffer.from(content).toString();

	it("returns all three shell files under completions/", async () => {
		const snapshot = await buildCli().snapshot();
		const artifacts = await completion().build?.({ snapshot, outDir });

		expect(artifacts?.map((file) => file.path)).toEqual([
			"completions/mycli",
			"completions/_mycli",
			"completions/mycli.fish",
		]);
		const [bash, zsh, fish] = artifacts!.map((file) => text(file.content));
		expect(bash).toContain("# completion script for mycli v1.2.3");
		expect(bash).toContain("complete -o default -F _mycli 'mycli'");
		expect(zsh).toStartWith("#compdef mycli\n");
		expect(fish).toContain("complete -c 'mycli' -f");
	});

	it("honors binName and version overrides at build time", async () => {
		const snapshot = await buildCli().snapshot();
		const artifacts = await completion({ binName: "my-tool", version: "2.0.0" }).build?.({
			snapshot,
			outDir,
		});

		expect(artifacts?.map((file) => file.path)).toEqual([
			"completions/my-tool",
			"completions/_my-tool",
			"completions/my-tool.fish",
		]);
		expect(text(artifacts![1]!.content)).toStartWith("#compdef my-tool\n");
		expect(text(artifacts![0]!.content)).toContain("my-tool v2.0.0");
	});

	it("rejects an unsafe binName", async () => {
		const snapshot = await buildCli().snapshot();
		expect(() => completion({ binName: "../pwn" }).build?.({ snapshot, outDir })).toThrow(
			/invalid binName/,
		);
	});

	it("rejects a missing version", async () => {
		const snapshot = await new Crust("mycli").snapshot();
		expect(() => completion().build?.({ snapshot, outDir })).toThrow("requires a version");
	});

	it("pure renderers match build and runtime files byte-for-byte", async () => {
		const tmpDir = await mkdtemp(join(tmpdir(), "crust-completion-build-"));
		try {
			const app = buildCli();
			const snapshot = await app.snapshot();
			const options: CompletionRenderOptions = { version: "1.2.3" };
			const artifacts = await completion(options).build?.({ snapshot, outDir });
			await app.execute({ argv: ["completion", "zsh", "--output-dir", tmpDir] });

			for (const [filename, render] of [
				["mycli", renderBashCompletion],
				["_mycli", renderZshCompletion],
				["mycli.fish", renderFishCompletion],
			] as const) {
				const script = render(snapshot, options);
				const built = artifacts?.find((file) => file.path === `completions/${filename}`);
				expect(built && text(built.content)).toBe(script);
				expect(script).toBe(await readFile(join(tmpDir, filename), "utf8"));
			}
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("completion renderers", () => {
	it("uses snapshot metadata by default and honors overrides", async () => {
		const snapshot = await buildCli().snapshot();
		expect(renderBashCompletion(snapshot)).toStartWith("# completion script for mycli v1.2.3");
		expect(renderZshCompletion(snapshot)).toStartWith("#compdef mycli\n");
		expect(renderFishCompletion(snapshot, { binName: "my-tool", version: "9.9.9" })).toStartWith(
			"# completion script for my-tool v9.9.9",
		);
	});

	it("validates names, requires a version, and sanitizes header text", async () => {
		const snapshot = await new Crust("mycli").snapshot();
		for (const render of [renderBashCompletion, renderZshCompletion, renderFishCompletion]) {
			expect(() => render(snapshot, { binName: "../pwn", version: "1" })).toThrow(
				/invalid binName/,
			);
			expect(() => render(snapshot)).toThrow("completion extension requires a version");
			expect(render(snapshot, { version: "1\ninjected" })).not.toContain("\ninjected");
		}
	});
});
