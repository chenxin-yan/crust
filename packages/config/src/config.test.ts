import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { help, input, version } from "@crustjs/extensions";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { defineConfig } from "./config.ts";

let root: string;
let cwd: string;
const saved = {
	cwd: process.cwd(),
	xdg: process.env.XDG_CONFIG_HOME,
	appData: process.env.APPDATA,
	telemetry: process.env.ACME_TELEMETRY,
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-"));
	// configDir() reads XDG_CONFIG_HOME on Linux and macOS, APPDATA on Windows: both point here.
	process.env.XDG_CONFIG_HOME = join(root, "xdg");
	process.env.APPDATA = join(root, "xdg");
	delete process.env.ACME_TELEMETRY;
	cwd = join(root, "repo", "sub");
	mkdirSync(cwd, { recursive: true });
	process.chdir(cwd);
});

afterEach(() => {
	process.chdir(saved.cwd);
	for (const [name, value] of [
		["XDG_CONFIG_HOME", saved.xdg],
		["APPDATA", saved.appData],
		["ACME_TELEMETRY", saved.telemetry],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

const globalFile = () => join(root, "xdg", "acme", "config.json");
const projectFile = () => join(root, "repo", "acme.config.json");
function write(path: string, content: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

function acme() {
	const config = defineConfig({
		name: "acme",
		global: true,
		project: true,
		flags: {
			level: { type: "string", env: { name: "ACME_LEVEL" }, default: "default" },
			org: { type: "string", description: "Organization", env: { name: "ACME_ORG" } },
			region: { type: "string", description: "Region", choices: ["us", "eu"], default: "us" },
			port: { type: "number", short: "p" },
			timeout: { type: "string", parse: (raw) => Number(raw) * 1000, default: "30" },
			tags: { type: "string", multiple: true },
			yes: { type: "boolean", noNegate: true },
			telemetry: { type: "boolean", flag: false, env: { name: "ACME_TELEMETRY" } },
		},
	});
	const show = defineCommand("show", (command) =>
		command.use(config).action(async ({ ctx, stdout }) => {
			const value = await ctx.config;
			stdout(JSON.stringify(value));
			return value;
		}),
	);
	const ping = defineCommand("ping", (command) =>
		command.action(({ stdout }) => {
			stdout("pong");
			return "pong";
		}),
	);
	const app = new Crust("acme", { version: "1.0.0" })
		.provide(config())
		.extend(help(), version(), input())
		.add(show, ping);
	return { config, app };
}

/** `acme show` through argv: the settings it printed. */
async function viaArgv(argv: readonly string[] = [], env: Record<string, string> = {}) {
	const { stdout, stderr, exitCode } = await captureExecute(acme().app, ["show", ...argv], { env });
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as Record<string, unknown>;
}

/** `acme show` through typed `run()`: the settings it returned. */
async function viaRun(flags: { level?: string } = {}, env: Record<string, string> = {}) {
	const outcome = await acme().app.run(["show"], { flags }, { env });
	if (outcome.status !== "completed") throw outcome.status === "failed" ? outcome.error : outcome;
	return outcome.result;
}

describe("precedence: flag › env › project file › global file › default", () => {
	const rows = [
		{ sources: [], level: "default" },
		{ sources: ["global"], level: "global" },
		{ sources: ["global", "project"], level: "project" },
		{ sources: ["global", "project", "env"], level: "env" },
		{ sources: ["global", "project", "env", "flag"], level: "flag" },
	] as const;

	function given(sources: readonly string[]) {
		if (sources.includes("global")) write(globalFile(), { level: "global" });
		if (sources.includes("project")) write(projectFile(), { level: "project" });
		const env: Record<string, string> = sources.includes("env") ? { ACME_LEVEL: "env" } : {};
		return { env, flag: sources.includes("flag") };
	}

	it.each(rows)("execute(): $sources gives $level", async ({ sources, level }) => {
		const { env, flag } = given(sources);
		expect(await viaArgv(flag ? ["--level", "flag"] : [], env)).toMatchObject({ level });
	});

	it.each(rows)("typed run(): $sources gives $level", async ({ sources, level }) => {
		const { env, flag } = given(sources);
		expect(await viaRun(flag ? { level: "flag" } : {}, env)).toMatchObject({ level });
	});

	it("--input wins over env, and argv over --input", async () => {
		given(["global", "project"]);
		const json = JSON.stringify({ level: "input" });
		expect(await viaArgv(["--input", json], { ACME_LEVEL: "env" })).toMatchObject({
			level: "input",
		});
		expect(await viaArgv(["--input", json, "--level", "flag"])).toMatchObject({ level: "flag" });
	});

	it("reads the nearest project file from the working directory up", async () => {
		write(join(root, "acme.config.json"), { level: "far", org: "far" });
		write(projectFile(), { level: "near" });
		expect(await viaRun()).toMatchObject({ level: "near" });
		// Files do not merge: a key the nearest file lacks comes from the global file, not a farther one.
		expect(await viaRun()).toMatchObject({ org: undefined });
	});

	it("takes each key from the first source that has it", async () => {
		write(globalFile(), { org: "global-org", region: "eu" });
		write(projectFile(), { org: "project-org" });
		expect(await viaRun()).toMatchObject({ org: "project-org", region: "eu" });
	});
});

describe("files", () => {
	it("reads file names of its own", async () => {
		const config = defineConfig({
			name: "acme",
			global: "settings.json",
			project: ".acme.json",
			flags: { org: { type: "string" }, region: { type: "string" } },
		});
		write(join(root, "xdg", "acme", "settings.json"), { org: "global", region: "global" });
		write(join(root, "repo", ".acme.json"), { org: "project" });
		const app = new Crust("acme")
			.provide(config())
			.command("show", (command) => command.use(config).action(async ({ ctx }) => ctx.config));
		expect(await app.run(["show"], {})).toMatchObject({
			result: { org: "project", region: "global" },
		});
	});

	it.each([
		["a directory", { global: "dir/settings.json" }],
		["a Windows directory", { project: "dir\\settings.json" }],
		["another extension", { global: "settings.toml" }],
		["no name", { project: ".json" }],
		["no file at all", {}],
	])("rejects %s at definition", (_, files) => {
		expect(() => defineConfig({ name: "acme", flags: {}, ...(files as { global: true }) })).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});

	it("rejects an app name with a directory at definition", () => {
		expect(() => defineConfig({ name: "a/b", global: true, flags: {} })).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});

	it("ignores keys it does not declare, such as $schema", async () => {
		write(projectFile(), { $schema: "./schema.json", org: "o", other: 1 });
		expect(await viaRun()).toMatchObject({ org: "o" });
	});
});

describe("settings", () => {
	it("reads each kind of setting in the shape the user types it", async () => {
		write(projectFile(), { port: 8080, tags: ["a", "b"], timeout: "5", yes: true, region: "eu" });
		expect(await viaRun()).toMatchObject({
			port: 8080,
			tags: ["a", "b"],
			timeout: 5000,
			yes: true,
			region: "eu",
		});
	});

	it("applies a default after the files, parsing a parse setting's default", async () => {
		expect(await viaRun()).toMatchObject({
			region: "us",
			timeout: 30_000,
			port: undefined,
			tags: undefined,
		});
	});

	it("takes a flag setting from argv in its flag form", async () => {
		write(projectFile(), { tags: ["file"], yes: true });
		expect(
			await viaArgv(["-p", "1", "--tags", "x", "--tags", "y", "--timeout", "2"]),
		).toMatchObject({ port: 1, tags: ["x", "y"], timeout: 2000, yes: true });
	});

	it("reads a flag: false setting from env and the files, never from a flag", async () => {
		write(globalFile(), { telemetry: false });
		expect(await viaRun()).toMatchObject({ telemetry: false });
		process.env.ACME_TELEMETRY = "1";
		expect(await viaRun()).toMatchObject({ telemetry: true });
		const { exitCode, stderr } = await captureExecute(acme().app, ["show", "--telemetry"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("--telemetry");
		const outcome = await acme().app.run(["show"], { flags: { telemetry: true } } as never);
		expect(outcome).toMatchObject({ status: "failed" });
	});

	it("fails a missing required setting naming every place it can come from", async () => {
		const config = defineConfig({
			name: "acme",
			global: true,
			project: true,
			flags: {
				org: { type: "string", env: { name: "ACME_ORG" }, required: true },
				token: { type: "string", flag: false, required: true },
			},
		});
		const app = new Crust("acme")
			.provide(config())
			.command("show", (command) => command.use(config).action(async ({ ctx }) => ctx.config));
		const { exitCode, stderr } = await captureExecute(app, ["show"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(
			`Missing setting "org" of acme: pass --org, set ACME_ORG, or set "org" in acme.config.json or ${globalFile()}.`,
		);
		expect(stderr).toContain(
			`Missing setting "token" of acme: set "token" in acme.config.json or ${globalFile()}.`,
		);
		write(projectFile(), { token: "t" });
		expect(await app.run(["show"], { flags: { org: "o" } })).toMatchObject({
			result: { org: "o", token: "t" },
		});
	});
});

describe("errors", () => {
	it("names the file of malformed JSON, and only commands that read the config fail", async () => {
		write(projectFile(), "{ broken");
		const show = await captureExecute(acme().app, ["show"]);
		expect(show.exitCode).toBe(1);
		expect(show.stderr).toContain(`Malformed JSON in store file: ${projectFile()}`);
		expect(await captureExecute(acme().app, ["ping"])).toMatchObject({
			exitCode: 0,
			stdout: "pong",
		});
		expect(await captureExecute(acme().app, ["show", "--help"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(acme().app, ["--version"])).toMatchObject({ exitCode: 0 });
	});

	it("names the file and each key of a wrong value, without the value", async () => {
		write(globalFile(), { org: 7, region: "mars", port: "80x", tags: "a", yes: false });
		const { exitCode, stderr } = await captureExecute(acme().app, ["show"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(`Store validation failed (read) in ${globalFile()}`);
		for (const line of [
			"org: Expected string",
			"region: Expected one of: us, eu",
			"port: Expected number",
			"tags: Expected string[]",
			"yes: Expected true",
		]) {
			expect(stderr).toContain(line);
		}
		expect(stderr).not.toContain("mars");
	});

	it("names the file when parse rejects a file value", async () => {
		const config = defineConfig({
			name: "acme",
			project: true,
			flags: {
				when: {
					type: "string",
					parse: (raw) => {
						if (Number.isNaN(Date.parse(raw))) throw new Error("not a date");
						return raw;
					},
				},
			},
		});
		write(projectFile(), { when: "soon" });
		const app = new Crust("acme")
			.provide(config())
			.command("show", (command) => command.use(config).action(async ({ ctx }) => ctx.config));
		const { exitCode, stderr } = await captureExecute(app, ["show"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(`Invalid value for "when" in ${projectFile()}.`);
	});

	it("creates no file or directory when it reads", async () => {
		await viaRun();
		expect(existsSync(join(root, "xdg"))).toBe(false);
	});

	it.each([
		["an unknown property", { org: { type: "string", nope: 1 } }],
		["a property named like an Object member", { org: { type: "string", toString: 1 } }],
		["a url setting", { api: { type: "url" } }],
		["a schema", { org: { type: "string", schema: {} } }],
		[
			"a default outside its choices",
			{ region: { type: "string", choices: ["us"], default: "eu" } },
		],
	])("rejects %s at definition", (_, flags) => {
		expect(() => defineConfig({ name: "acme", global: true, flags: flags as never })).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});
});

describe("config.global", () => {
	it("writes the global file through the typed store, which converts and validates", async () => {
		const { config } = acme();
		await config.global.patch({ org: "saved" });
		expect(JSON.parse(readFileSync(globalFile(), "utf8"))).toEqual({ org: "saved" });
		expect(await viaRun()).toMatchObject({ org: "saved" });
		// A command-line value arrives as text: the store converts it to the setting's type.
		await config.global.patch({ port: "8080" } as never);
		expect(await config.global.read()).toMatchObject({ org: "saved", port: 8080 });
		await expect(config.global.patch({ region: "mars" } as never)).rejects.toMatchObject({
			code: "VALIDATION",
			details: { path: globalFile() },
		});
	});

	it("is absent without a global file", () => {
		const config = defineConfig({ name: "acme", project: true, flags: {} });
		expect("global" in config).toBe(false);
	});
});

describe("config.jsonSchema()", () => {
	it("describes the file: what the user types for each setting, and nothing else", () => {
		expect(acme().config.jsonSchema()).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			title: "acme config file",
			type: "object",
			properties: {
				$schema: { type: "string" },
				level: { type: "string", default: "default" },
				org: { type: "string", description: "Organization" },
				region: { enum: ["us", "eu"], description: "Region", default: "us" },
				port: { type: "number" },
				timeout: { type: "string", default: "30" },
				tags: { type: "array", items: { type: "string" } },
				yes: { const: true },
				telemetry: { type: "boolean" },
			},
			additionalProperties: false,
		});
	});
});

describe("the factory", () => {
	it("is a copy of the Context factory that core treats as the same Context", async () => {
		const { config } = acme();
		const show = defineCommand("show", (command) =>
			command.use(config).action(async ({ ctx }) => (await ctx.config).org),
		);
		const double = { org: "double" } as Parameters<typeof config.of>[0];
		expect(
			await new Crust("acme").provide(config.of(double)).add(show).run(["show"], {}),
		).toMatchObject({ status: "completed", result: "double" });
		write(projectFile(), { org: "file" });
		expect(await new Crust("acme").provide(config()).add(show).run(["show"], {})).toMatchObject({
			status: "completed",
			result: "file",
		});
	});

	it("documents the settings and their files on the providing command", async () => {
		const { stdout } = await captureExecute(acme().app, ["--help"]);
		expect(stdout).toContain("Configuration");
		expect(stdout).toContain(
			"Each setting is the first of: its flag, its environment variable, acme.config.json (the nearest from the working directory up), config.json in the configuration directory of acme, its default.",
		);
		expect(stdout).toMatch(/region\s+Region \[default: "us"\] \[choices: us, eu\]/u);
		expect(stdout).toMatch(/telemetry\s+\[env: ACME_TELEMETRY\]/u);
	});
});
