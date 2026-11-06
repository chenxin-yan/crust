import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Crust, CrustError } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { input } from "./input.ts";

function deployApp() {
	return new Crust("app")
		.extend(input())
		.args({ name: "target", type: "string", required: true })
		.flags({
			region: { type: "string", default: "us" },
			force: { type: "boolean", default: false },
			tags: { type: "string", multiple: true },
			origin: { type: "url" },
		})
		.action(({ args, flags, rawArgs, stdout }) => {
			const { target } = args;
			const { region, force, tags, origin } = flags;
			const result = { target, region, force, tags, origin: origin?.href, rawArgs };
			stdout(JSON.stringify(result));
			return result;
		});
}

async function failure(payload: string) {
	const outcome = await deployApp().run([], {
		args: { target: "typed" },
		flags: { input: payload },
	});
	if (outcome.status !== "failed") throw new Error(`expected a failure, got ${outcome.status}`);
	return outcome.error;
}

describe("input", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("binds args, flags, and raw passthrough from inline JSON", async () => {
		const payload = JSON.stringify({
			target: "prod",
			region: "eu",
			force: true,
			tags: ["a", "b"],
			origin: "https://example.com/",
			raw: ["--dry"],
		});

		const { stdout, exitCode } = await captureExecute(deployApp(), ["--input", payload]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			target: "prod",
			region: "eu",
			force: true,
			tags: ["a", "b"],
			origin: "https://example.com/",
			rawArgs: ["--dry"],
		});
	});

	it("lets arguments and flags given on argv win over the same JSON keys", async () => {
		const { stdout } = await captureExecute(deployApp(), [
			"staging",
			"--region",
			"us",
			"--input",
			'{"target":"prod","region":"eu","force":true}',
		]);

		expect(JSON.parse(stdout)).toMatchObject({ target: "staging", region: "us", force: true });
	});

	it("never converts JSON values that argv overrides", async () => {
		const origin = await captureExecute(deployApp(), [
			"prod",
			"--origin",
			"https://example.com/",
			"--input",
			'{"origin":"not a url"}',
		]);
		const raw = await captureExecute(deployApp(), ["prod", "--input", '{"raw":"x"}', "--", "a"]);

		expect(origin.exitCode).toBe(0);
		expect(JSON.parse(origin.stdout)).toMatchObject({ origin: "https://example.com/" });
		expect(raw.exitCode).toBe(0);
		expect(JSON.parse(raw.stdout)).toMatchObject({ target: "prod", rawArgs: ["a"] });
	});

	it("reads JSON from a file named with @", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-input-"));
		tempDirs.push(dir);
		const file = join(dir, "input.json");
		writeFileSync(file, '{"target":"prod","region":"eu"}');

		const { stdout, exitCode } = await captureExecute(deployApp(), ["--input", `@${file}`]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ target: "prod", region: "eu" });
	});

	it("replaces typed run() input with JSON passed as the input flag", async () => {
		const outcome = await deployApp().run([], {
			args: { target: "typed" },
			flags: { input: '{"target":"prod"}' },
		});

		expect(outcome).toMatchObject({
			status: "completed",
			result: { target: "prod", region: "us" },
		});
	});

	it("changes nothing without --input", async () => {
		const { stdout } = await captureExecute(deployApp(), ["prod"]);

		expect(JSON.parse(stdout)).toMatchObject({ target: "prod", region: "us", force: false });
	});

	it.each([
		["unparseable JSON", "{target", /^--input: invalid JSON \(/],
		[
			"a JSON array",
			'["prod"]',
			/^--input: expected a JSON object keyed by argument and flag names/,
		],
		["JSON null", "null", /^--input: expected a JSON object keyed by argument and flag names/],
		["an unreadable file", "@/nonexistent/crust-input.json", /^--input: cannot read/],
		["an invalid URL", '{"target":"prod","origin":"not a url"}', /^--input: expected a URL \(/],
	])("fails with a PARSE error for %s", async (_label, payload, message) => {
		const error = await failure(payload);

		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({ code: "PARSE" });
		expect((error as CrustError).message).toMatch(message);
	});

	it("reports unknown keys and mistyped values as the structured binder does", async () => {
		expect(await failure('{"target":"prod","nope":1}')).toMatchObject({
			code: "PARSE",
			message: 'Unknown flag "--nope"',
		});
		expect(await failure('{"target":"prod","force":"yes"}')).toMatchObject({
			code: "PARSE",
			message: "Expected boolean for --force",
		});
	});

	it("renders an --input error through execute() with exit code 1", async () => {
		expect(await captureExecute(deployApp(), ["--input", "{target"])).toMatchObject({
			stdout: "",
			exitCode: 1,
		});
	});

	// Tests run on Node; spawn each runtime so stdin is a real pipe.
	it.each([
		["node", process.execPath, ["--input-type=module"]],
		["bun", "bun", []],
	])("reads JSON from stdin for - on %s", (_runtime, command, options) => {
		const script = `
			import { Crust } from "@crustjs/core";
			import { input } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "input.ts")).href)};
			const app = new Crust("app")
				.extend(input())
				.flags({ region: { type: "string", default: "us" } })
				.action(({ flags, stdout }) => stdout(flags.region));
			process.exitCode = await app.execute({ argv: ["--input", "-"] });
		`;
		const run = spawnSync(command, [...options, "-e", script], {
			cwd: join(import.meta.dirname, ".."),
			input: '{"region":"eu"}',
			encoding: "utf8",
			timeout: 10_000,
		});

		expect(run.stderr).toBe("");
		expect(run.stdout.trim()).toBe("eu");
		expect(run.status).toBe(0);
	});
});
