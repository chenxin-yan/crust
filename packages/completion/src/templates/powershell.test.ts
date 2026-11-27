import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { reapBoundedProcesses, runBoundedProcess } from "../../../crust/tests/bounded-process.ts";
import { powershellSingleQuote } from "../escape.ts";
import type { CompletionCommand } from "../spec.ts";
import { renderPowerShell } from "./powershell.ts";
import { fixture } from "./test-fixtures.ts";

afterEach(reapBoundedProcesses);

const completeFixture: CompletionCommand = {
	name: "mycli",
	flags: [
		{ name: "hidden", spellings: ["-.", "--hidden"], type: "boolean", takesValue: false },
		{ name: "quote", spellings: ["-'"], type: "boolean", takesValue: false },
	],
	args: [],
	subCommands: [
		{
			name: "deploy",
			description: "Ship it’s build",
			flags: [
				{
					name: "region",
					spellings: ["-r", "--region"],
					type: "string",
					takesValue: true,
					complete: "mycli deploy --region",
				},
			],
			args: [
				{
					name: "service",
					type: "string",
					required: true,
					variadic: false,
					complete: "mycli deploy service",
				},
			],
			subCommands: [],
		},
	],
};

const passthroughFixture: CompletionCommand = {
	name: "mycli",
	flags: [],
	args: [],
	subCommands: [
		{
			name: "box",
			flags: [
				{ name: "rm", spellings: ["--rm"], type: "boolean", takesValue: false },
				{ name: "name", spellings: ["--name"], type: "string", takesValue: true },
			],
			args: [
				{ name: "image", type: "string", required: true, variadic: false, choices: ["img"] },
				{ name: "command", type: "string", required: false, variadic: false, choices: ["cmd"] },
				{
					name: "tail",
					type: "string",
					required: false,
					variadic: "passthrough",
					choices: ["tail"],
				},
			],
			subCommands: [],
		},
	],
};

describe("renderPowerShell", () => {
	it("registers a native completer for the command, after a header naming the regenerate command", () => {
		const script = renderPowerShell(fixture, "mycli", "1.0.0", "completions");
		expect(script).toMatch(
			/^# completion script for mycli v1\.0\.0 — regenerate with: mycli completions powershell\n/,
		);
		expect(script).toContain(
			"Register-ArgumentCompleter -Native -CommandName 'mycli' -ScriptBlock {",
		);
	});

	it("emits the tree with case-sensitive lists of spellings, choices and complete addresses", () => {
		const script = renderPowerShell(fixture, "mycli", "1.0.0");
		expect(script).toContain("@{ Names = @('deploy', 'dep'); Desc = 'Deploy'; Node = @{");
		expect(script).toContain(
			"@{ Spellings = @('--target'); Value = $true; Desc = ''; Choices = @('browser', 'bun', 'node') }",
		);

		const complete = renderPowerShell(completeFixture, "mycli", "1.0.0");
		expect(complete).toContain(
			"@{ Spellings = @('-r', '--region'); Value = $true; Desc = ''; Complete = 'mycli deploy --region' }",
		);
		expect(complete).toContain("@{ Variadic = ''; Complete = 'mycli deploy service' }");
		expect(complete).toContain(`& 'mycli' '__complete' '--' $def.Complete "$word" 2>$null`);
	});

	it("quotes punctuation shorts and typographic apostrophes", () => {
		const script = renderPowerShell(completeFixture, "mycli", "1.0.0");
		expect(script).toContain("Spellings = @('-.', '--hidden')");
		expect(script).toContain("Spellings = @('-''')");
		expect(script).toContain("Desc = 'Ship it’’s build'");
		expect(powershellSingleQuote("a'b‘c’d")).toBe("'a''b‘‘c’’d'");
	});
});

const pwshAvailable = await isPwshAvailable();
// The `__complete` stub is a POSIX shell script.
const describeIfPwsh = pwshAvailable && process.platform !== "win32" ? describe : describe.skip;

// Each completion starts pwsh, about a second apiece on a CI runner.
describeIfPwsh("renderPowerShell · TabExpansion2", { timeout: 60_000 }, () => {
	let tmpDir: string;
	let scriptPath: string;
	let completeScriptPath: string;
	let passthroughScriptPath: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "pwsh-completion-"));
		scriptPath = join(tmpDir, "fixture.ps1");
		completeScriptPath = join(tmpDir, "complete.ps1");
		await writeFile(scriptPath, renderPowerShell(fixture, "mycli", "1.0.0"), "utf8");
		await writeFile(
			completeScriptPath,
			renderPowerShell(completeFixture, "mycli", "1.0.0"),
			"utf8",
		);
		passthroughScriptPath = join(tmpDir, "passthrough.ps1");
		await writeFile(
			passthroughScriptPath,
			renderPowerShell(passthroughFixture, "mycli", "1.0.0"),
			"utf8",
		);
		// Answers `mycli __complete -- <address> <word>` as the hidden command would.
		const stub = join(tmpDir, "mycli");
		await writeFile(
			stub,
			`#!/bin/sh\n[ "$1" = __complete ] && [ "$2" = -- ] || exit 0\nprintf '%s\\n' "$4-one" "$4-two" "$4’s" "\${3##* }"\n`,
		);
		await chmod(stub, 0o755);
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function complete(script: string, line: string): Promise<string[]> {
		const command = [
			`$env:PATH = ${powershellSingleQuote(`${tmpDir}${delimiter}`)} + $env:PATH`,
			`. ${powershellSingleQuote(script)}`,
			`(TabExpansion2 -inputScript ${powershellSingleQuote(line)} -cursorColumn ${line.length}).CompletionMatches | ForEach-Object { $_.CompletionText }`,
		].join("; ");
		const { exitCode, stdout, stderr } = await runBoundedProcess(
			"pwsh",
			["-NoProfile", "-NonInteractive", "-Command", command],
			{ timeout: 20_000 },
		);
		if (exitCode !== 0) throw new Error(`pwsh exited ${exitCode}\nstderr:\n${stderr}`);
		return stdout
			.split(/\r?\n/)
			.filter((candidate) => candidate !== "")
			.sort();
	}

	it("completes subcommands, flags, and flag choices", async () => {
		expect(await complete(scriptPath, "mycli ")).toEqual(["build", "dep", "deploy"]);
		expect(await complete(scriptPath, "mycli deploy ")).toEqual(["prod"]);
		expect(await complete(scriptPath, "mycli build --t")).toEqual(["--target"]);
		expect(await complete(scriptPath, "mycli build --target ")).toEqual(["browser", "bun", "node"]);
		expect(await complete(scriptPath, "mycli build --target=b")).toEqual([
			"--target=browser",
			"--target=bun",
		]);
	});

	it("offers punctuation shorts and the values of complete functions", async () => {
		// PowerShell reads a bare `'` as a string, so `-'` is inserted quoted.
		expect(await complete(completeScriptPath, "mycli -")).toEqual(["'-'''", "--hidden", "-."]);
		// A typographic apostrophe ends a single-quoted string in PowerShell, so it is quoted and doubled.
		expect(await complete(completeScriptPath, "mycli deploy --region us")).toEqual([
			"'us’’s'",
			"us-one",
			"us-two",
		]);
		expect(await complete(completeScriptPath, "mycli deploy api")).toEqual([
			"'api’’s'",
			"api-one",
			"api-two",
		]);
	});

	it("quotes a value PowerShell would expand: a wildcard, or a leading `~`", async () => {
		expect(await complete(completeScriptPath, "mycli deploy --region *.m")).toEqual([
			"'*.m-one'",
			"'*.m-two'",
			"'*.m’’s'",
		]);
		expect(await complete(completeScriptPath, "mycli deploy --region ~/a")).toEqual([
			"'~/a-one'",
			"'~/a-two'",
			"'~/a’’s'",
		]);
		// A `~` elsewhere is not expanded.
		expect(await complete(completeScriptPath, "mycli deploy --region a~")).toEqual([
			"'a~’’s'",
			"a~-one",
			"a~-two",
		]);
	});

	it("completes a quoted current word by its value", async () => {
		expect(await complete(scriptPath, "mycli build --target 'br")).toEqual(["browser"]);
		expect(await complete(scriptPath, 'mycli "dep')).toEqual(["dep", "deploy"]);
		expect(await complete(completeScriptPath, "mycli deploy --region 'us")).toEqual([
			"'us’’s'",
			"us-one",
			"us-two",
		]);
	});

	it('offers no flags after the first positional of a command with a "passthrough" argument', async () => {
		expect(await complete(passthroughScriptPath, "mycli box --")).toEqual(["--name", "--rm"]);
		expect(await complete(passthroughScriptPath, "mycli box img ")).toEqual(["cmd"]);
		// From the first positional on, every word fills a slot, as Core binds it.
		expect(await complete(passthroughScriptPath, "mycli box img --rm ")).toEqual(["tail"]);
		expect(await complete(passthroughScriptPath, "mycli box img --name x ")).toEqual(["tail"]);
		expect(await complete(passthroughScriptPath, "mycli box img -- ")).toEqual(["tail"]);
		expect(await complete(passthroughScriptPath, "mycli box --rm --name x img ")).toEqual(["cmd"]);
		// A lone `-` (stdin) is a positional.
		expect(await complete(passthroughScriptPath, "mycli box - ")).toEqual(["cmd"]);
	});
});

async function isPwshAvailable(): Promise<boolean> {
	// A missing pwsh skips; a hung one fails at the probe deadline instead of skipping.
	if (which("pwsh") === null) return false;
	return (
		(await runBoundedProcess("pwsh", ["-NoProfile", "-Command", "exit 0"], { timeout: 20_000 }))
			.exitCode === 0
	);
}
