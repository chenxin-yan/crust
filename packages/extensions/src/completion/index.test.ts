import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../../crust/tests/build-hooks.ts";
import {
	completion,
	type CompletionOptions,
	type CompletionRenderOptions,
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from "../index.ts";

function buildCli(options?: CompletionOptions) {
	return new Crust("mycli", { description: "Test CLI", version: "1.2.3" })
		.extend(completion(options))
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

	it("`mycli completion bash` prints a bash script to stdout", async () => {
		const app = buildCli();
		const { stdout: out } = await captureExecute(app, ["completion", "bash"]);
		expect(out.startsWith("# completion script for mycli v1.2.3")).toBe(true);
		expect(out).toContain("complete -o default -F _mycli 'mycli'");
		// Choice values are validated to a safe character set and emitted
		// bare in the `compgen -W` wordlist.
		expect(out).toContain("browser bun node"); // build --target
		expect(out).toContain("dev staging prod"); // deploy prod --env
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
			const { stdout } = await captureExecute(buildCli(), [
				"completion",
				"fish",
				"--output-dir",
				tmpDir,
			]);
			expect(stdout).toBe("");
		});
	});
});

describe("completion build hook", () => {
	it("returns all three shell files under completions/", async () => {
		const { files } = await runBuildHooks(buildCli());

		expect([...files.keys()]).toEqual([
			"completions/mycli",
			"completions/_mycli",
			"completions/mycli.fish",
		]);
		const [bash, zsh, fish] = files.values();
		expect(bash).toContain("# completion script for mycli v1.2.3");
		expect(bash).toContain("complete -o default -F _mycli 'mycli'");
		expect(zsh).toMatch(/^#compdef mycli\n/);
		expect(fish).toContain("complete -c 'mycli' -f");
	});

	it("names the configured command in each regenerate hint", async () => {
		const { files } = await runBuildHooks(
			new Crust("mycli", { version: "1.0.0" }).extend(completion({ command: "completions" })),
		);

		const [bash, zsh, fish] = files.values();
		expect(bash).toContain("regenerate with: mycli completions bash\n");
		expect(zsh).toContain("regenerate with: mycli completions zsh\n");
		expect(fish).toContain("regenerate with: mycli completions fish\n");
	});

	it("pure renderers match build and runtime files byte-for-byte", async () => {
		const tmpDir = await mkdtemp(join(tmpdir(), "crust-completion-build-"));
		try {
			const options: CompletionRenderOptions = { version: "1.2.3" };
			const app = buildCli(options);
			const snapshot = await app.snapshot();
			const { files } = await runBuildHooks(app);
			await app.execute({ argv: ["completion", "zsh", "--output-dir", tmpDir] });

			for (const [filename, render] of [
				["mycli", renderBashCompletion],
				["_mycli", renderZshCompletion],
				["mycli.fish", renderFishCompletion],
			] as const) {
				const script = render(snapshot, options);
				expect(files.get(`completions/${filename}`)).toBe(script);
				expect(script).toBe(await readFile(join(tmpDir, filename), "utf8"));
			}
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("completion renderers", () => {
	it("uses snapshot metadata by default and honors a version override", async () => {
		const snapshot = await buildCli().snapshot();
		expect(renderBashCompletion(snapshot)).toMatch(/^# completion script for mycli v1\.2\.3/);
		expect(renderZshCompletion(snapshot)).toMatch(/^#compdef mycli\n/);
		expect(renderFishCompletion(snapshot, { version: "9.9.9" })).toMatch(
			/^# completion script for mycli v9\.9\.9/,
		);
	});

	it("validates names, requires a version, and sanitizes header text", async () => {
		const snapshot = await new Crust("mycli").snapshot();
		const unsafe = await new Crust("../pwn").snapshot();
		for (const render of [renderBashCompletion, renderZshCompletion, renderFishCompletion]) {
			expect(() => render(unsafe, { version: "1" })).toThrow(/invalid root command name/);
			expect(() => render(snapshot)).toThrow("completion extension requires a version");
			expect(render(snapshot, { version: "1\ninjected" })).not.toContain("\ninjected");
		}
	});
});
