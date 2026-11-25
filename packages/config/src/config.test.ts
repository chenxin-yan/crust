import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { help, input, version } from "@crustjs/extensions";
import { captureExecute, type ExecutableApp, withEnv } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineConfig } from "./config.ts";

let root: string;
let cwd: string;
const saved = {
	cwd: process.cwd(),
	xdg: process.env.XDG_CONFIG_HOME,
	appData: process.env.APPDATA,
	telemetry: process.env.ACME_TELEMETRY,
	noCache: process.env.ACME_NO_CACHE,
	level: process.env.ACME_LEVEL,
	org: process.env.ACME_ORG,
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-"));
	// configDir() reads XDG_CONFIG_HOME on Linux and macOS, APPDATA on Windows: both point here.
	process.env.XDG_CONFIG_HOME = join(root, "xdg");
	process.env.APPDATA = join(root, "xdg");
	// The fixtures' variables come only from each case, never from the shell running the tests.
	delete process.env.ACME_TELEMETRY;
	delete process.env.ACME_NO_CACHE;
	delete process.env.ACME_LEVEL;
	delete process.env.ACME_ORG;
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
		["ACME_NO_CACHE", saved.noCache],
		["ACME_LEVEL", saved.level],
		["ACME_ORG", saved.org],
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
	}).flags({
		level: { type: "string", env: "ACME_LEVEL", default: "default" },
		org: { type: "string", description: "Organization", env: "ACME_ORG" },
		region: { type: "string", description: "Region", choices: ["us", "eu"], default: "us" },
		port: { type: "number", short: "p", min: 1, max: 65535 },
		timeout: { type: "string", parse: (raw) => Number(raw) * 1000, default: "30" },
		tags: { type: "string", multiple: true },
		yes: { type: "boolean" },
		telemetry: { type: "boolean", flag: false, env: "ACME_TELEMETRY" },
	});
	const app = shows(
		config,
		new Crust("acme", { version: "1.0.0" }).extend(help(), version(), input()) as never,
	).command("ping", (command) =>
		command.action(({ stdout }) => {
			stdout("pong");
			return "pong";
		}),
	);
	return { config, app };
}

interface LooseCommand {
	use(...factories: unknown[]): LooseCommand;
	action(
		run: (input: {
			ctx: Record<string, Promise<unknown>>;
			stdout: (text: string) => void;
		}) => unknown,
	): LooseCommand;
}
interface LooseApp extends ExecutableApp {
	extend(...extensions: unknown[]): LooseApp;
	command(name: string, recipe: (command: LooseCommand) => LooseCommand): LooseApp;
	run(
		path: string[],
		input?: object,
		options?: object,
	): Promise<{ status: string; result?: unknown; error?: unknown }>;
}

/**
 * An app whose `show` reads every setting of `config` and returns and prints them by name, typed
 * loosely for any config: the typed shape is pinned in config.test-d.ts.
 */
function shows(
	config: { readonly settings: object; readonly extension: unknown },
	// SAFETY: test-only view of the same calls the typed tests make.
	app = new Crust("acme") as unknown as LooseApp,
): LooseApp {
	const names = Object.keys(config.settings);
	return app.extend(config.extension).command("show", (command) =>
		command.use(...Object.values(config.settings)).action(async ({ ctx, stdout }) => {
			const value = Object.fromEntries(
				await Promise.all(names.map(async (name) => [name, await ctx[name]] as const)),
			);
			stdout(JSON.stringify(value));
			return value;
		}),
	);
}

/** `show` through typed `run()`: the settings, or the failure's error. */
async function result(app: LooseApp, flags = {}) {
	const outcome = await app.run(["show"], { flags });
	if (outcome.status !== "completed") throw outcome.error;
	return outcome.result as Record<string, unknown>;
}

/** `acme show` through argv: the settings it printed. */
async function viaArgv(argv: readonly string[] = [], env: Record<string, string> = {}) {
	const { stdout, stderr, exitCode } = await captureExecute(acme().app, ["show", ...argv], {
		env: { ...process.env, ...env },
	});
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as Record<string, unknown>;
}

/** `acme show` through typed `run()`: the settings it returned. */
async function viaRun(flags: { level?: string } = {}, env: Record<string, string> = {}) {
	const outcome = await withEnv({ ...process.env, ...env }, () =>
		acme().app.run(["show"], { flags }),
	);
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
		}).flags({ org: { type: "string" }, region: { type: "string" } });
		write(join(root, "xdg", "acme", "settings.json"), { org: "global", region: "global" });
		write(join(root, "repo", ".acme.json"), { org: "project" });
		const app = shows(config);
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
		expect(() => defineConfig({ name: "acme", ...(files as { global: true }) }).flags({})).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});

	it("rejects an app name with a directory at definition", () => {
		expect(() => defineConfig({ name: "a/b", global: true }).flags({})).toThrow(
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

	it("turns off a boolean setting with default: true by --no-<name>", async () => {
		const config = defineConfig({ name: "acme", project: true }).flags({
			cache: { type: "boolean", default: true },
		});
		const run = (argv: string[]) => captureExecute(shows(config), ["show", ...argv]);
		expect(JSON.parse((await run([])).stdout)).toEqual({ cache: true });
		const off = await run(["--no-cache"]);
		expect(off.exitCode, off.stderr).toBe(0);
		expect(JSON.parse(off.stdout)).toEqual({ cache: false });
	});

	it("reads a flag: false setting from env and the files, never from a flag", async () => {
		write(globalFile(), { telemetry: false });
		expect(await viaRun()).toMatchObject({ telemetry: false });
		process.env.ACME_TELEMETRY = "1";
		expect(await viaRun()).toMatchObject({ telemetry: true });
		const { exitCode, stderr } = await captureExecute(acme().app, ["show", "--telemetry"]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("--telemetry");
		const outcome = await acme().app.run(["show"], { flags: { telemetry: true } });
		expect(outcome).toMatchObject({ status: "failed" });
	});

	it("fails a missing required setting naming every place it can come from", async () => {
		const config = defineConfig({
			name: "acme",
			global: true,
			project: true,
		}).flags({
			org: { type: "string", env: "ACME_ORG", required: true },
			token: { type: "string", flag: false, required: true },
		});
		const app = shows(config);
		const { exitCode, stderr } = await captureExecute(app, ["show"]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain(
			`Missing setting "org" of acme: pass --org, set ACME_ORG, or set "org" in acme.config.json or ${globalFile()}.`,
		);
		const token = await captureExecute(app, ["show", "--org", "o"]);
		expect(token.stderr).toContain(
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
			stdout: "pong\n",
		});
		expect(await captureExecute(acme().app, ["show", "--help"])).toMatchObject({ exitCode: 0 });
		expect(await captureExecute(acme().app, ["--version"])).toMatchObject({ exitCode: 0 });
	});

	it("names the file and each key of a wrong value, without the value", async () => {
		write(globalFile(), { org: 7, region: "mars", port: "80x", tags: "a", yes: "no" });
		const { exitCode, stderr } = await captureExecute(acme().app, ["show"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(`Store validation failed (read) in ${globalFile()}`);
		for (const line of [
			"org: Expected string",
			"region: Expected one of: us, eu",
			"port: Expected number",
			"tags: Expected string[]",
			"yes: Expected boolean",
		]) {
			expect(stderr).toContain(line);
		}
		expect(stderr).not.toContain("mars");
	});

	it("keeps a file's number within the setting's min and max", async () => {
		write(globalFile(), { port: 0 });
		const { exitCode, stderr } = await captureExecute(acme().app, ["show"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("port: Expected at least 1");
	});

	it("names the file when parse rejects a file value", async () => {
		const config = defineConfig({
			name: "acme",
			project: true,
		}).flags({
			when: {
				type: "string",
				parse: (raw) => {
					if (Number.isNaN(Date.parse(raw))) throw new Error("not a date");
					return raw;
				},
			},
		});
		write(projectFile(), { when: "soon" });
		const app = shows(config);
		const { exitCode, stderr } = await captureExecute(app, ["show"]);
		expect(exitCode).toBe(2);
		// As core shows a parser's message for a flag, the file path shows it too.
		expect(stderr).toContain(`Invalid value for "when" in ${projectFile()}: not a date`);
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
	])("rejects %s at definition", (_, flags) => {
		expect(() => defineConfig({ name: "acme", global: true }).flags(flags as never)).toThrow(
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
		const config = defineConfig({ name: "acme", project: true }).flags({});
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
				port: { type: "number", minimum: 1, maximum: 65535 },
				timeout: { type: "string", default: "30" },
				tags: { type: "array", items: { type: "string" } },
				yes: { type: "boolean" },
				telemetry: { type: "boolean" },
			},
			additionalProperties: false,
		});
	});

	it("leaves out a bound that is not finite", () => {
		const config = defineConfig({ name: "acme", project: true }).flags({
			a: { type: "number", min: Number.NaN, max: Number.POSITIVE_INFINITY },
		});
		expect(config.jsonSchema().properties).toEqual({
			$schema: { type: "string" },
			a: { type: "number" },
		});
	});
});

describe("one Context per setting", () => {
	it("gives a command only the flags of the settings it uses", async () => {
		const { config } = acme();
		const { org, port } = config.settings;
		// Reusable commands: an inline `.command()` child would also parse its parent's provided flags.
		const serve = defineCommand("serve", (command) =>
			command.use(port).action(async ({ ctx }) => ctx.port),
		);
		const deploy = defineCommand("deploy", (command) =>
			command.use(org).action(async ({ ctx }) => ctx.org),
		);
		const app = new Crust("acme").extend(config.extension).add(serve, deploy);
		expect(await app.run(["serve"], { flags: { port: 8080 } })).toMatchObject({
			status: "completed",
			result: 8080,
		});
		const unknown = await captureExecute(app, ["serve", "--org", "x"]);
		expect(unknown.exitCode).toBe(2);
		expect(unknown.stderr).toContain('Unknown flag "--org"');
		write(projectFile(), { org: "file" });
		expect(await app.run(["deploy"], {})).toMatchObject({ result: "file" });
	});

	it("reads the files for each setting read from them, and not for one its flag gave", async () => {
		const { config } = acme();
		write(projectFile(), { org: "o", region: "eu", port: 1 });
		const fs = process.getBuiltinModule("node:fs/promises");
		const open = fs.open;
		const opened: string[] = [];
		const spy = vi.spyOn(fs, "open").mockImplementation((path, ...rest) => {
			opened.push(String(path));
			return open(path, ...rest);
		});
		try {
			const { org, region, port } = config.settings;
			const show = defineCommand("show", (command) =>
				command
					.use(org, region, port)
					.action(async ({ ctx }) => [await ctx.org, await ctx.region, await ctx.port]),
			);
			const app = new Crust("acme").extend(config.extension).add(show);
			expect(await app.run(["show"], {})).toMatchObject({
				result: ["o", "eu", 1],
			});
			// No snapshot is shared: each setting read from the files reads them.
			expect(opened.filter((path) => path === projectFile())).toHaveLength(3);
			opened.length = 0;
			expect(await app.run(["show"], { flags: { org: "f", region: "us", port: 2 } })).toMatchObject(
				{ result: ["f", "us", 2] },
			);
			expect(opened.filter((path) => path === projectFile())).toHaveLength(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("gives a run that starts after a write the new value while another run is still open", async () => {
		const { config } = acme();
		let release!: () => void;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reading!: () => void;
		const read = new Promise<void>((resolve) => {
			reading = resolve;
		});
		const hold = defineCommand("hold", (command) =>
			command.use(config.settings.org).action(async ({ ctx }) => {
				const value = await ctx.org;
				reading();
				await paused;
				return value;
			}),
		);
		const deploy = defineCommand("deploy", (command) =>
			command.use(config.settings.org).action(async ({ ctx }) => ctx.org),
		);
		const app = new Crust("acme").extend(config.extension).add(hold, deploy);
		await config.global.patch({ org: "old" });
		const first = app.run(["hold"], {});
		await read;
		await config.global.patch({ org: "new" });
		expect(await app.run(["deploy"], {})).toMatchObject({ result: "new" });
		release();
		expect(await first).toMatchObject({ result: "old" });
	});

	it("reads the files again for the next run, even with the same caller signal", async () => {
		const { config } = acme();
		const deploy = defineCommand("deploy", (command) =>
			command.use(config.settings.org).action(async ({ ctx }) => ctx.org),
		);
		const app = new Crust("acme").extend(config.extension).add(deploy);
		const { signal } = new AbortController();
		write(projectFile(), { org: "first" });
		expect(await app.run(["deploy"], {}, { signal })).toMatchObject({ result: "first" });
		write(projectFile(), { org: "second" });
		expect(await app.run(["deploy"], {}, { signal })).toMatchObject({ result: "second" });
		write(projectFile(), "{ broken");
		expect(await app.run(["deploy"], {}, { signal })).toMatchObject({ status: "failed" });
		write(projectFile(), { org: "fixed" });
		expect(await app.run(["deploy"], {}, { signal })).toMatchObject({ result: "fixed" });
	});

	it("reads no file for a setting its flag or variable gave", async () => {
		const { config } = acme();
		const { org } = config.settings;
		write(projectFile(), "{ broken");
		const app = new Crust("acme")
			.extend(config.extension)
			.command("deploy", (command) => command.use(org).action(async ({ ctx }) => ctx.org));
		expect(await app.run(["deploy"], { flags: { org: "flag" } })).toMatchObject({
			status: "completed",
			result: "flag",
		});
		expect(
			await withEnv({ ...process.env, ACME_ORG: "env" }, () => app.run(["deploy"], {})),
		).toMatchObject({ result: "env" });
		expect(await app.run(["deploy"], {})).toMatchObject({ status: "failed" });
	});

	it("replaces one setting in a test with its .of() double", async () => {
		const { org } = acme().config.settings;
		const show = defineCommand("show", (command) =>
			command.use(org).action(async ({ ctx }) => ctx.org),
		);
		// Without the Extension: a setting's Context depends on nothing.
		expect(await new Crust("acme").provide(org.of("double")).add(show).run(["show"])).toMatchObject(
			{ status: "completed", result: "double" },
		);
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

describe("review fixes", () => {
	it("keeps null from a parser as the winning value", async () => {
		const config = defineConfig({
			name: "acme",
			global: true,
			project: true,
		}).flags({ mode: { type: "string", parse: (raw) => (raw === "off" ? null : raw) } });
		write(projectFile(), { mode: "on" });
		write(globalFile(), { mode: "global" });
		expect(await result(shows(config), { mode: "off" })).toEqual({ mode: null });
		write(projectFile(), { mode: "off" });
		expect(await result(shows(config))).toEqual({ mode: null });
	});

	it.each([
		["constructor", true],
		["toString", true],
		["constructor", false],
		["toString", false],
	])("reads a setting named %s (flag: %s) only from its own sources", async (name, flagged) => {
		const setting = flagged
			? { type: "string", required: true }
			: { type: "string", flag: false, required: true };
		// Object.fromEntries keeps `__proto__` an own key.
		const flags = Object.fromEntries([[name, setting]]) as Record<string, { type: "string" }>;
		const config = defineConfig({ name: "acme", global: true, project: true }).flags(flags);
		await expect(result(shows(config))).rejects.toMatchObject({ code: "VALIDATION" });
		write(projectFile(), JSON.parse(`{"${name}": "file"}`));
		const values = await result(shows(config));
		expect(Object.getOwnPropertyDescriptor(values, name)?.value).toBe("file");
	});

	it.each([true, false])(
		"rejects a setting named __proto__ (flag: %s) at definition",
		(flagged) => {
			// Core refuses the name for a flag and for env parsing alike.
			const setting = flagged ? { type: "string" } : { type: "string", flag: false };
			const flags = Object.fromEntries([["__proto__", setting]]) as Record<
				string,
				{ type: "string" }
			>;
			expect(() => defineConfig({ name: "acme", global: true }).flags(flags)).toThrow(
				expect.objectContaining({ code: "DEFINITION" }),
			);
		},
	);

	it("keeps its own copy of each setting, and a fresh array default per invocation", async () => {
		const choices = ["a", "b"];
		const config = defineConfig({
			name: "acme",
			global: true,
		}).flags({
			tags: { type: "string", multiple: true, choices, default: ["a"] },
		});
		choices.push("z");
		const app = new Crust("acme").extend(config.extension).command("show", (command) =>
			command.use(config.settings.tags).action(async ({ ctx }) => {
				const tags = await ctx.tags;
				const copy = [...tags];
				tags.push("b");
				return copy;
			}),
		);
		expect(await app.run(["show"], {})).toMatchObject({ result: ["a"] });
		expect(await app.run(["show"], {})).toMatchObject({ result: ["a"] });
		expect(config.jsonSchema()).toMatchObject({
			properties: { tags: { type: "array", items: { enum: ["a", "b"] }, default: ["a"] } },
		});
		write(globalFile(), { tags: ["z"] });
		await expect(app.run(["show"], {})).resolves.toMatchObject({ status: "failed" });
	});

	it("reads and writes the global file where the config directory is now", async () => {
		const config = defineConfig({ name: "acme", global: true }).flags({ org: { type: "string" } });
		const app = shows(config);
		write(globalFile(), { org: "first" });
		expect(await result(app)).toEqual({ org: "first" });
		process.env.XDG_CONFIG_HOME = join(root, "other");
		process.env.APPDATA = join(root, "other");
		const other = join(root, "other", "acme", "config.json");
		write(other, { org: "second" });
		expect(await result(app)).toEqual({ org: "second" });
		await config.global.patch({ org: "patched" });
		expect(JSON.parse(readFileSync(other, "utf8"))).toEqual({ org: "patched" });
		expect(JSON.parse(readFileSync(globalFile(), "utf8"))).toEqual({ org: "first" });
	});

	it("fails on an invalid value in a file a command reads, even when a flag gives that setting", async () => {
		const config = defineConfig({
			name: "acme",
			global: true,
		}).flags({ region: { type: "string", choices: ["us", "eu"] }, org: { type: "string" } });
		// org comes from the file, which must be valid as a whole.
		write(globalFile(), { region: "old", org: "o" });
		await expect(result(shows(config), { region: "us" })).rejects.toMatchObject({
			code: "VALIDATION",
			details: { path: globalFile() },
		});
	});

	it.each([
		["a setting named $schema", { name: "acme", global: true }, { $schema: { type: "string" } }],
		[
			"a flag: false setting named $schema",
			{ name: "acme", global: true },
			{ $schema: { type: "string", flag: false } },
		],
		["the name .", { name: ".", global: true }, {}],
		["the name ..", { name: "..", global: true }, {}],
		["a file name whose stem ends in .json", { name: "acme", global: "prefs.json.json" }, {}],
	])("rejects %s at definition", (_, options, settings) => {
		expect(() => defineConfig(options as never).flags(settings as never)).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});

	it("reads a project file in a directory whose name ends in .json", async () => {
		const dir = join(root, "repo.json");
		mkdirSync(dir);
		process.chdir(dir);
		write(join(dir, "acme.config.json"), { org: "dotted" });
		const config = defineConfig({
			name: "acme",
			project: true,
		}).flags({ org: { type: "string" } });
		expect(await result(shows(config))).toEqual({ org: "dotted" });
	});

	it.skipIf(process.platform === "win32")(
		"takes the first entry walking up, so a nearer dangling link reads as no values",
		async () => {
			write(projectFile(), { org: "far" });
			symlinkSync(join(root, "missing.json"), join(cwd, "acme.config.json"));
			const config = defineConfig({
				name: "acme",
				project: true,
			}).flags({ org: { type: "string" } });
			expect(await result(shows(config))).toEqual({ org: undefined });
		},
	);

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"names the path when it cannot inspect a project file candidate",
		async () => {
			const { chmodSync } = await import("node:fs");
			chmodSync(cwd, 0o000);
			try {
				const config = defineConfig({
					name: "acme",
					project: true,
				}).flags({ org: { type: "string" } });
				await expect(result(shows(config))).rejects.toMatchObject({
					name: "CrustStoreError",
					code: "IO",
					details: { path: join(cwd, "acme.config.json"), operation: "read" },
				});
			} finally {
				chmodSync(cwd, 0o755);
			}
		},
	);
});

describe("flag: false settings and parsers", () => {
	it("reads a flag: false setting whose name is no argv spelling, without and with a variable", async () => {
		const config = defineConfig({ name: "acme", project: true }).flags({
			"no-proxy": { type: "string", flag: false },
			"no-cache": { type: "string", flag: false, env: "ACME_NO_CACHE" },
		});
		write(projectFile(), { "no-proxy": "local", "no-cache": "file" });
		expect(await result(shows(config))).toEqual({ "no-proxy": "local", "no-cache": "file" });
		const outcome = await shows(config).run(["show"], {});
		expect(outcome).toMatchObject({ status: "completed" });
		process.env.ACME_NO_CACHE = "env";
		try {
			expect(await result(shows(config))).toMatchObject({ "no-cache": "env" });
		} finally {
			delete process.env.ACME_NO_CACHE;
		}
	});

	it("names the setting, not an internal key, when a flag: false setting's variable is invalid", async () => {
		const config = defineConfig({ name: "acme", project: true }).flags({
			retries: { type: "number", flag: false, env: "ACME_RETRIES" },
		});
		process.env.ACME_RETRIES = "abc";
		try {
			await expect(result(shows(config))).rejects.toMatchObject({
				message: "Expected a number for --retries (from $ACME_RETRIES).",
			});
		} finally {
			delete process.env.ACME_RETRIES;
		}
	});

	it.each([
		["a file value", { when: "x" }, {}],
		["a default", {}, { default: ["x"] }],
	])("refuses a parser that returns a promise for %s", async (_, file, extra) => {
		const rejected = vi.fn();
		process.on("unhandledRejection", rejected);
		try {
			const config = defineConfig({ name: "acme", project: true }).flags({
				when: {
					type: "string",
					multiple: true,
					parse: ((raw: string) => Promise.reject(new Error(raw))) as never,
					...extra,
				} as never,
			});
			write(projectFile(), Object.keys(file).length ? { when: ["x"] } : {});
			await expect(result(shows(config))).rejects.toMatchObject({
				code: "PARSE",
				message: expect.stringContaining("parse must be synchronous"),
			});
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(rejected).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", rejected);
		}
	});
});

describe("defineConfig(options).flags(settings)", () => {
	it("checks the files in defineConfig(), before any setting is declared", () => {
		expect(() => defineConfig({ name: "acme", global: "a/b.json" } as never)).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
		expect(() => defineConfig({ name: "acme" } as never)).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
	});

	it("takes the settings only from .flags(), never as an option", () => {
		expect(() =>
			defineConfig({ name: "acme", global: true, flags: { org: { type: "string" } } } as never),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
	});

	it("refuses a settings record that is not a plain object, such as a __proto__ literal", () => {
		const builder = defineConfig({ name: "acme", global: true });
		expect(() => builder.flags({ __proto__: { type: "string" } } as never)).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
		expect(() => builder.flags(null as never)).toThrow(
			expect.objectContaining({ code: "DEFINITION" }),
		);
		expect(Object.keys(builder.flags(Object.create(null)).settings)).toEqual([]);
	});

	it("returns a builder whose only member is flags, and .flags() is called once", () => {
		const builder = defineConfig({ name: "acme", global: true });
		expect(Object.keys(builder)).toEqual(["flags"]);
		expect(Object.isFrozen(builder)).toBe(true);
		const config = builder.flags({ org: { type: "string" } });
		expect("flags" in config).toBe(false);
		// Settings, the Extension, the schema and the global store: nothing callable, no Context.
		expect(Object.keys(config).sort()).toEqual(["extension", "global", "jsonSchema", "settings"]);
		expect(config.settings.org.contextName).toBe("org");
	});
});
