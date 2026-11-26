import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { json } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import {
	completion,
	type CompletionOptions,
	type CompletionRenderOptions,
	renderBashCompletion,
	renderFishCompletion,
	renderPowerShellCompletion,
	renderZshCompletion,
} from "./index.ts";

function buildCli(options?: CompletionOptions) {
	return new Crust("mycli", { description: "Test CLI", version: "1.2.3" })
		.extend(completion(options))
		.add(
			defineCommand("build", { description: "Build artifact" }, (cmd) =>
				cmd
					.flags({ target: { type: "string", choices: ["browser", "bun", "node"] } })
					.action(() => {}),
			),
			defineCommand("deploy", { description: "Deploy", aliases: ["dep"] }, (cmd) =>
				cmd
					.add(
						defineCommand("prod", { description: "Production deploy" }, (sub) =>
							sub
								.flags({
									env: {
										type: "string",
										choices: ["dev", "staging", "prod"],
									},
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
		const app = new Crust("mycli", { version: "1.0.0" })
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

	it("returns the script, so --json prints it as one JSON string", async () => {
		const app = buildCli().extend(json());
		const { stdout: script } = await captureExecute(app, ["completion", "bash"]);

		expect(await captureExecute(app, ["completion", "bash", "--json"])).toEqual({
			stdout: `${JSON.stringify(script.slice(0, -1))}\n`,
			stderr: "",
			exitCode: 0,
		});
	});

	describe("--output-dir", () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = await mkdtemp(join(tmpdir(), "tp010-completion-"));
		});

		afterEach(async () => {
			await rm(tmpDir, { recursive: true, force: true });
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
	it("names the configured command in each regenerate hint", async () => {
		const { files } = await runBuildHooks(
			new Crust("mycli", { version: "1.0.0" }).extend(completion({ command: "completions" })),
		);

		const [bash, zsh, fish, powershell] = files.values();
		expect(bash).toContain("regenerate with: mycli completions bash\n");
		expect(zsh).toContain("regenerate with: mycli completions zsh\n");
		expect(fish).toContain("regenerate with: mycli completions fish\n");
		expect(powershell).toContain("regenerate with: mycli completions powershell\n");
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
				["mycli.ps1", renderPowerShellCompletion],
			] as const) {
				const script = await render(snapshot, options);
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
		expect(await renderBashCompletion(snapshot)).toMatch(/^# completion script for mycli v1\.2\.3/);
		expect(await renderZshCompletion(snapshot)).toMatch(/^#compdef mycli\n/);
		expect(await renderFishCompletion(snapshot, { version: "9.9.9" })).toMatch(
			/^# completion script for mycli v9\.9\.9/,
		);
	});

	it("validates names, requires a version, and sanitizes header text", async () => {
		const snapshot = await new Crust("mycli").snapshot();
		const unsafe = await new Crust("../pwn").snapshot();
		for (const render of [
			renderBashCompletion,
			renderZshCompletion,
			renderFishCompletion,
			renderPowerShellCompletion,
		]) {
			await expect(render(unsafe, { version: "1" })).rejects.toThrow(/invalid root command name/);
			await expect(render(snapshot)).rejects.toThrow("completion extension requires a version");
			expect(await render(snapshot, { version: "1\ninjected" })).not.toContain("\ninjected");
		}
	});
});

describe("complete", () => {
	const regions = ["us-east", "us-west", "eu-central"];
	const app = new Crust("mycli", { version: "1.0.0" }).extend(completion()).add(
		defineCommand("deploy", (cmd) =>
			cmd
				.args({
					name: "service",
					type: "string",
					complete: async (typed) => [`${typed}-api`, `${typed}-web`],
				})
				.flags({
					region: {
						type: "string",
						complete: (typed) => regions.filter((region) => region.startsWith(typed)),
					},
					scope: {
						type: "exclusive",
						flags: {
							team: { type: "string", complete: () => ["core", "line\nbreak", "tab\there"] },
						},
					},
				})
				.action(() => {}),
		),
	);

	it("prints a flag's values for the word, one per line", async () => {
		expect(await captureExecute(app, ["__complete", "--", "mycli deploy --region", "us"])).toEqual({
			stdout: "us-east\nus-west\n",
			stderr: "",
			exitCode: 0,
		});
	});

	it("reads a missing word as empty, as a shell that drops an empty argument sends it", async () => {
		const { stdout } = await captureExecute(app, ["__complete", "--", "mycli deploy --region"]);
		expect(stdout).toBe(`${regions.join("\n")}\n`);
	});

	it("awaits an argument's values and reaches an exclusive group's member", async () => {
		expect(
			(await captureExecute(app, ["__complete", "--", "mycli deploy service", "x"])).stdout,
		).toBe("x-api\nx-web\n");
		// A value with a line break or a tab cannot be read back as one value, so it is left out.
		expect((await captureExecute(app, ["__complete", "--", "mycli deploy --team"])).stdout).toBe(
			"core\n",
		);
	});

	it("prints the choices of a definition whose choices the scripts cannot hold", async () => {
		const plans = new Crust("mycli", { version: "1.0.0" })
			.extend(completion())
			.flags({
				plan: { type: "string", choices: ["free tier", "pro"] },
				size: { type: "string", choices: ["s", "m"] },
				scope: { type: "exclusive", flags: { team: { type: "string", choices: ["a b"] } } },
			})
			.args({ name: "target", type: "string", choices: ["-1", "$(x)"] })
			.action(() => {});
		const values = async (address: string) =>
			(await captureExecute(plans, ["__complete", "--", address, "f"])).stdout;
		// Every choice: the shell keeps those that start with the word.
		expect(await values("mycli --plan")).toBe("free tier\npro\n");
		expect(await values("mycli --team")).toBe("a b\n");
		expect(await values("mycli target")).toBe("-1\n$(x)\n");
		// Choices the scripts hold are not asked for.
		expect(await values("mycli --size")).toBe("");
	});

	it("prints nothing for an address without a complete function", async () => {
		for (const address of [
			"mycli deploy --scope",
			"mycli nope --region",
			"mycli service",
			"mycli __proto__ service",
			"mycli constructor service",
		]) {
			expect(await captureExecute(app, ["__complete", "--", address, "x"])).toEqual({
				stdout: "",
				stderr: "",
				exitCode: 0,
			});
		}
	});

	it("keeps __complete out of listings", async () => {
		const root = await app.snapshot();
		expect(root.subCommands.__complete?.meta.hidden).toBe(true);
	});

	it("owns the key: without completion(), a complete function is an unowned key", async () => {
		const bare = new Crust("mycli").flags({ region: { type: "string", complete: () => [] } });
		await expect(bare.snapshot()).rejects.toThrow(
			/sets "complete", which no installed Extension owns/,
		);
	});
});
