import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";
import { help } from "@crustjs/extensions";
import { prompts } from "@crustjs/prompts/extension";
import { captureExecute, withEnv } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { defineConfig } from "./config.ts";

let root: string;
const saved = { cwd: process.cwd(), env: { ...process.env } };

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-"));
	// configDir() reads XDG_CONFIG_HOME on Linux and macOS, APPDATA on Windows: both point here.
	process.env.XDG_CONFIG_HOME = join(root, "xdg");
	process.env.APPDATA = join(root, "xdg");
	// The fixtures' variables come only from each case, never from the shell running the tests.
	delete process.env.ACME_REGION;
	delete process.env.ACME_TOKEN;
	mkdirSync(join(root, "repo", "sub"), { recursive: true });
	process.chdir(join(root, "repo", "sub"));
});

afterEach(() => {
	process.chdir(saved.cwd);
	process.env = { ...saved.env };
	rmSync(root, { recursive: true, force: true });
});

const userFile = (name = "config.json") => join(root, "xdg", "acme", name);
const projectFile = (name = "acme.config.json") => join(root, "repo", name);
function write(path: string, content: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

function acme(options: { files?: Parameters<typeof defineConfig>[0]["files"] } = {}) {
	const config = defineConfig({
		name: "acme",
		settings: {
			region: { type: "string", choices: ["us", "eu"], default: "us", env: "ACME_REGION" },
			replicas: { type: "number", min: 1 },
			timeout: { type: "string", parse: (raw) => Number(raw) * 1000, default: "30" },
			tags: { type: "string", multiple: true, delimiter: "," },
			pager: { type: "string" },
			psFormat: { type: "string", choices: ["table", "json"], default: "table" },
		},
		project: ["region", "replicas", "tags"],
		command: true,
		...options,
	});
	const app = new Crust("acme")
		.extend(help(), config.extension)
		.command("deploy", (command) =>
			command
				.flags({
					region: config.flag("region"),
					replicas: config.flag("replicas"),
					timeout: config.flag("timeout"),
					tags: config.flag("tags"),
					pager: config.flag("pager"),
				})
				.action(({ flags, stdout }) => {
					stdout(JSON.stringify(flags));
					return flags;
				}),
		)
		.command("ps", (command) =>
			command
				.flags({ format: config.flag("psFormat") })
				.action(({ flags, stdout }) => stdout(`ps: ${flags.format}`)),
		);
	return { config, app };
}

async function deploy(argv: readonly string[] = [], env: Record<string, string> = {}) {
	const { stdout, stderr, exitCode } = await captureExecute(acme().app, ["deploy", ...argv], {
		env: { ...process.env, ...env },
	});
	expect(exitCode, stderr).toBe(0);
	return { flags: JSON.parse(stdout) as Record<string, unknown>, stderr };
}

describe("flags take the files' values", () => {
	it("in order: the command line, the variable, the project file, the user's file, the default", async () => {
		expect((await deploy()).flags.region).toBe("us");
		write(userFile(), { region: "eu", replicas: 2 });
		expect((await deploy()).flags).toMatchObject({ region: "eu", replicas: 2 });
		write(projectFile(), { replicas: 3 });
		// Each setting on its own: replicas from the project file, region from the user's file.
		expect((await deploy()).flags).toMatchObject({ region: "eu", replicas: 3 });
		write(projectFile(), { region: "us", replicas: 3 });
		expect((await deploy()).flags.region).toBe("us");
		expect((await deploy([], { ACME_REGION: "eu" })).flags.region).toBe("eu");
		expect((await deploy(["--region", "us"], { ACME_REGION: "eu" })).flags.region).toBe("us");
	});

	it("in typed run(), for the values its input leaves out", async () => {
		write(userFile(), { region: "eu", replicas: 2 });
		const { app } = acme();
		const outcome = await app.run(["deploy"], { flags: { replicas: 5 } });
		expect(outcome).toMatchObject({ status: "completed", result: { region: "eu", replicas: 5 } });
	});

	it("under any flag name", async () => {
		write(userFile(), { psFormat: "json" });
		expect((await captureExecute(acme().app, ["ps"])).stdout).toBe("ps: json\n");
	});

	it("converts text as an environment variable's, and a number or boolean as its text", async () => {
		write(userFile(), { replicas: "4", timeout: 2, tags: "a,b" });
		expect((await deploy()).flags).toMatchObject({ replicas: 4, timeout: 2000, tags: ["a", "b"] });
		write(userFile(), { tags: ["a", "b,c"] });
		expect((await deploy()).flags.tags).toEqual(["a", "b", "c"]);
	});

	it("names the file and the setting for a value that does not convert", async () => {
		write(projectFile(), { replicas: "many" });
		const { exitCode, stderr } = await captureExecute(acme().app, ["deploy"]);
		expect(exitCode).toBe(2);
		expect(stderr).toBe(`Error: Expected a number for "replicas" in ${projectFile()}.\n`);
		write(projectFile(), { region: { name: "eu" } });
		expect((await captureExecute(acme().app, ["deploy"])).stderr).toBe(
			`Error: Expected one value for "region" in ${projectFile()}.\n`,
		);
	});

	it("takes a value from the next file when a file's converts to nothing, as get() does", async () => {
		write(projectFile(), { tags: [] });
		write(userFile(), { tags: ["u"] });
		expect((await deploy()).flags.tags).toEqual(["u"]);
		expect(await acme().config.get("tags")).toEqual(["u"]);
	});

	it("keeps two configs' same-named settings apart", async () => {
		const a = defineConfig({ name: "aaa", settings: { region: { type: "string" } } });
		const b = defineConfig({ name: "bbb", settings: { region: { type: "string" } } });
		write(join(root, "xdg", "aaa", "config.json"), { region: "from-a" });
		write(join(root, "xdg", "bbb", "config.json"), { region: "from-b" });
		const app = new Crust("x")
			.extend(a.extension, b.extension)
			.command("c", (command) =>
				command
					.flags({ ra: a.flag("region"), rb: b.flag("region") })
					.action(({ flags, stdout }) => stdout(`${flags.ra} ${flags.rb}`)),
			);
		expect((await captureExecute(app, ["c"])).stdout).toBe("from-a from-b\n");
	});

	it("leaves --help working whatever the files hold", async () => {
		write(userFile(), "{ broken");
		const help = await captureExecute(acme().app, ["deploy", "--help"]);
		expect(help.exitCode, help.stderr).toBe(0);
		const run = await captureExecute(acme().app, ["deploy"]);
		expect(run).toMatchObject({
			exitCode: 2,
			stderr: `Error: Malformed config file: ${userFile()}\n`,
		});
	});

	it("reads no file for a command whose config flags the run gave", async () => {
		write(userFile(), "{ broken");
		const { exitCode } = await captureExecute(acme().app, ["ps", "--format", "json"]);
		expect(exitCode).toBe(0);
	});

	it("needs the Extension: a config flag without it is an unowned key", async () => {
		const { config } = acme();
		const app = new Crust("acme").command("ps", (command) =>
			command.flags({ format: config.flag("psFormat") }).action(() => {}),
		);
		const { exitCode, stderr } = await captureExecute(app, ["ps"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("which no installed Extension owns");
	});
});

it("composes with prompts(): a value found in a file is not asked for", async () => {
	const { config } = acme();
	// Before prompts(), so a file's error fails the run before anything is asked.
	const app = new Crust("acme").extend(config.extension, prompts()).command("deploy", (command) =>
		command
			.flags({
				region: { ...config.flag("region"), prompt: "Region" },
				replicas: { ...config.flag("replicas"), required: true, prompt: "Replicas" },
			})
			.action(({ flags, stdout }) => stdout(`${flags.region} x${flags.replicas}`)),
	);
	write(userFile(), { replicas: 2 });
	const asked = runInteractive(app, ["deploy"]);
	await asked.waitFor(/Region/);
	asked.keys("down", "return");
	expect(await asked.done).toMatchObject({ stdout: "eu x2\n", exitCode: 0 });
	expect(asked.screen()).not.toContain("Replicas");
});

describe("the project file", () => {
	it("is the nearest from the working directory up", async () => {
		write(projectFile(), { replicas: 2 });
		write(join(root, "repo", "sub", "acme.config.json"), { replicas: 3 });
		expect((await deploy()).flags.replicas).toBe(3);
	});

	it("sets only the settings in the project list, and warns for the others naming both files", async () => {
		write(projectFile(), { pager: "touch PWNED", region: "eu", unknown: 1 });
		const { flags, stderr } = await deploy();
		expect(flags).toMatchObject({ region: "eu" });
		expect(flags.pager).toBeUndefined();
		const warning = `Warning: ${projectFile()} sets "pager", which only ${userFile()} may set; ignored.\n`;
		expect(stderr).toBe(warning);
		// Every run warns, also a second one of the same app.
		const { app } = acme();
		expect((await captureExecute(app, ["deploy"])).stderr).toBe(warning);
		expect((await captureExecute(app, ["deploy"])).stderr).toBe(warning);
	});

	it("is not read without a project list", async () => {
		const config = defineConfig({ name: "acme", settings: { pager: { type: "string" } } });
		write(projectFile(), { pager: "less" });
		expect(await config.get("pager")).toBeUndefined();
	});
});

describe("files", () => {
	const ini = {
		parse: (text: string) =>
			Object.fromEntries(
				text
					.split("\n")
					.filter((line) => line.includes("="))
					.map((line) => line.split("=").map((part) => part.trim())),
			),
		stringify: (values: Record<string, unknown>) =>
			Object.entries(values)
				.map(([key, value]) => `${key}=${String(value)}\n`)
				.join(""),
	};

	it("takes the files' names and format", async () => {
		const files = { user: "acmerc", project: ".acmerc", ...ini };
		write(userFile("acmerc"), "region = eu\n");
		write(projectFile(".acmerc"), "replicas = 3\n");
		const { app, config } = acme({ files });
		const { stdout } = await captureExecute(app, ["deploy"]);
		expect(JSON.parse(stdout)).toMatchObject({ region: "eu", replicas: 3 });
		await config.set({ pager: "less" });
		expect(readFileSync(userFile("acmerc"), "utf8")).toBe("region=eu\npager=less\n");
	});

	it("names a file that cannot be read", async () => {
		mkdirSync(userFile(), { recursive: true });
		expect(await captureExecute(acme().app, ["deploy"])).toMatchObject({
			exitCode: 2,
			stderr: `Error: Cannot read config file: ${userFile()}\n`,
		});
	});

	it("names a file that does not hold an object", async () => {
		write(userFile(), "[1]");
		await expect(acme().config.get("pager")).rejects.toThrow(
			`Config file ${userFile()} must hold an object of settings`,
		);
	});
});

describe("get, list and set", () => {
	it("get() reads a setting from its variable, the files or its default", async () => {
		const { config } = acme();
		expect(await config.get("timeout")).toBe(30_000);
		write(userFile(), { region: "eu" });
		expect(await config.get("region")).toBe("eu");
		await withEnv({ ...process.env, ACME_REGION: "us" }, async () => {
			expect(await config.get("region")).toBe("us");
		});
	});

	it("get() throws for a required setting that nothing gives", async () => {
		const config = defineConfig({
			name: "acme",
			settings: { org: { type: "string", env: "ACME_ORG", required: true } },
		});
		await expect(config.get("org")).rejects.toThrow(
			`Missing setting "org" of acme: set $ACME_ORG or "org" in ${userFile()}.`,
		);
	});

	it("list() gives every setting with its value and source", async () => {
		write(userFile(), { replicas: 2 });
		write(projectFile(), { tags: "a" });
		await withEnv({ ...process.env, ACME_REGION: "eu" }, async () => {
			expect(await acme().config.list()).toEqual([
				{ key: "region", value: "eu", source: { kind: "env", name: "ACME_REGION" } },
				{ key: "replicas", value: 2, source: { kind: "file", path: userFile() } },
				{ key: "timeout", value: 30_000, source: { kind: "default" } },
				{ key: "tags", value: ["a"], source: { kind: "file", path: projectFile() } },
				{ key: "pager", value: undefined, source: { kind: "unset" } },
				{ key: "psFormat", value: "table", source: { kind: "default" } },
			]);
		});
	});

	it("set() writes the user's file, keeping what it does not change; undefined removes", async () => {
		write(userFile(), { pager: "less", other: true });
		const { config } = acme();
		await config.set({ region: "eu", pager: undefined });
		expect(JSON.parse(readFileSync(userFile(), "utf8"))).toEqual({ other: true, region: "eu" });
	});

	it("set() saves one call at a time, each keeping the others' keys and the file's mode", async () => {
		write(userFile(), {});
		chmodSync(userFile(), 0o600);
		const { config } = acme();
		await Promise.all([
			config.set({ region: "eu" }),
			config.set({ pager: "less" }),
			config.set({ replicas: 2 }),
		]);
		expect(JSON.parse(readFileSync(userFile(), "utf8"))).toEqual({
			region: "eu",
			pager: "less",
			replicas: 2,
		});
		if (process.platform !== "win32") expect(statSync(userFile()).mode & 0o777).toBe(0o600);
	});

	it("set(values, { project: true }) writes the nearest project file, or one here", async () => {
		const { config } = acme();
		await config.set({ replicas: 2 }, { project: true });
		expect(JSON.parse(readFileSync(join(root, "repo", "sub", "acme.config.json"), "utf8"))).toEqual(
			{ replicas: 2 },
		);
	});
});

describe("command: true", () => {
	const run = (argv: readonly string[]) => captureExecute(acme().app, ["config", ...argv]);

	it("sets, gets and unsets a setting, converted as its text", async () => {
		expect(await run(["set", "replicas", "3"])).toMatchObject({
			exitCode: 0,
			stdout: `Saved replicas in ${userFile()}\n`,
		});
		expect(await run(["set", "timeout", "45"])).toMatchObject({ exitCode: 0 });
		expect(JSON.parse(readFileSync(userFile(), "utf8"))).toEqual({ replicas: 3, timeout: "45" });
		expect((await run(["get", "replicas"])).stdout).toBe("3\n");
		expect((await run(["unset", "replicas"])).stdout).toBe(`Removed replicas from ${userFile()}\n`);
		expect((await run(["get", "replicas"])).stdout).toBe("");
	});

	it("refuses a value that does not convert", async () => {
		expect(await run(["set", "region", "mars"])).toMatchObject({
			exitCode: 2,
			stderr: 'Error: Invalid value for "region". Expected one of: us, eu\n',
		});
	});

	it("writes the project file with --project, and only the settings it may set", async () => {
		expect(await run(["set", "--project", "region", "eu"])).toMatchObject({ exitCode: 0 });
		expect(JSON.parse(readFileSync(join(root, "repo", "sub", "acme.config.json"), "utf8"))).toEqual(
			{ region: "eu" },
		);
		expect(await run(["set", "--project", "pager", "less"])).toMatchObject({
			exitCode: 2,
			stderr:
				'Error: acme.config.json cannot set "pager"; it may set only: region, replicas, tags\n',
		});
	});

	it("lists every setting, its value and its source", async () => {
		write(userFile(), { replicas: 2 });
		expect((await run(["list"])).stdout).toBe(
			[
				"region    us     default",
				`replicas  2      ${userFile()}`,
				"timeout   30000  default",
				"tags             unset",
				"pager            unset",
				"psFormat  table  default",
				"",
			].join("\n"),
		);
	});
});

it("documents the files and the settings in the root's help", async () => {
	const { stdout } = await captureExecute(acme().app, ["--help"]);
	expect(stdout).toContain("Configuration:");
	expect(stdout).toContain(
		"acme.config.json (the nearest from the working directory up; only region, replicas, tags)",
	);
});

it("runs as if started in another folder with a -C Extension listed first", async () => {
	write(join(root, "other", "acme.config.json"), { replicas: 7 });
	const { config } = acme();
	const chdir = defineExtension(defineExtensionId("app:chdir"))
		.flags({ dir: { type: "path", short: "C" } })
		.setup((ctx) => {
			if (ctx.flags.dir) process.chdir(ctx.flags.dir);
		});
	const app = new Crust("acme")
		.extend(chdir, config.extension)
		.add(
			defineCommand("deploy", (command) =>
				command
					.flags({ replicas: config.flag("replicas") })
					.action(({ flags, stdout }) => stdout(String(flags.replicas))),
			),
		);
	const { stdout } = await captureExecute(app, ["-C", join(root, "other"), "deploy"], {
		cwd: process.cwd(),
	});
	expect(stdout).toBe("7\n");
});

it("describes a JSON file in its JSON Schema", () => {
	const { config } = acme();
	expect(config.jsonSchema()).toMatchObject({
		properties: {
			region: { enum: ["us", "eu"], default: "us" },
			replicas: { type: "number", minimum: 1 },
			timeout: { type: "string", default: "30" },
			tags: { type: "array", items: { type: "string" } },
		},
		additionalProperties: false,
	});
});

it("leaves out a bound that is not finite from the JSON Schema", () => {
	const config = defineConfig({
		name: "acme",
		settings: { a: { type: "number", min: Number.NaN, max: Number.POSITIVE_INFINITY } },
	});
	expect(config.jsonSchema().properties).toEqual({
		$schema: { type: "string" },
		a: { type: "number" },
	});
});
