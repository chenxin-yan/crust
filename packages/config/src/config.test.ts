import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Crust, defineCommand, defineExtension } from "@crustjs/core";
import { help } from "@crustjs/extensions";
import { prompts } from "@crustjs/prompts/extension";
import { captureExecute, withEnv } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

function acme(options: Pick<Parameters<typeof defineConfig>[0], "files" | "format"> = {}) {
	const config = defineConfig({
		name: "acme",
		both: {
			region: { type: "string", choices: ["us", "eu"], default: "us", env: "ACME_REGION" },
			// "value" is the name a file's text is converted under: an alias of it must still work.
			replicas: { type: "integer", min: 1, aliases: ["value"] },
			tags: { type: "string", multiple: true, delimiter: "," },
		},
		user: {
			timeout: { type: "string", parse: (raw) => Number(raw) * 1000, default: "30" },
			pager: { type: "string" },
			psFormat: { type: "string", choices: ["table", "json"], default: "table" },
		},
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
		for (const [replicas, expected] of [
			["many", "an integer"],
			[1.5, "an integer"],
			[0, "an integer of at least 1"],
		] as const) {
			write(projectFile(), { replicas });
			const { exitCode, stderr } = await captureExecute(acme().app, ["deploy"]);
			expect(exitCode).toBe(2);
			expect(stderr).toBe(`Error: Expected ${expected} for "replicas" in ${projectFile()}.\n`);
		}
		write(projectFile(), { region: { name: "eu" } });
		expect((await captureExecute(acme().app, ["deploy"])).stderr).toBe(
			`Error: Expected one value for "region" in ${projectFile()}.\n`,
		);
	});

	it("takes a value from the next file when a file's converts to nothing, as get() does", async () => {
		write(userFile(), { tags: ["u"] });
		for (const tags of [[], ","]) {
			write(projectFile(), { tags });
			expect((await deploy()).flags.tags).toEqual(["u"]);
			expect(await acme().config.get("tags")).toEqual(["u"]);
		}
	});

	it("keeps two configs' same-named settings apart", async () => {
		const a = defineConfig({ name: "aaa", user: { region: { type: "string" } } });
		const b = defineConfig({ name: "bbb", user: { region: { type: "string" } } });
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

	it("sets only the settings it may hold, and warns for the others naming both files", async () => {
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

	it("is read and saved in a folder whose name ends in .json", async () => {
		const folder = join(root, "site.json");
		write(join(folder, "acme.config.json"), { replicas: 4 });
		process.chdir(folder);
		expect((await deploy()).flags.replicas).toBe(4);
		await acme().config.set({ replicas: 5 }, { project: true });
		expect(JSON.parse(readFileSync(join(folder, "acme.config.json"), "utf8"))).toEqual({
			replicas: 5,
		});
	});

	it("is not looked for when no setting may be in it", async () => {
		const config = defineConfig({ name: "acme", user: { pager: { type: "string" } } });
		write(projectFile(), "{ broken");
		expect(await config.get("pager")).toBeUndefined();
	});

	it("warns once in a run, however often the run reads the files", async () => {
		write(projectFile(), { pager: "less" });
		const { config } = acme();
		const app = new Crust("acme").extend(config.extension).command("show", (command) =>
			command.flags({ region: config.flag("region") }).action(async ({ stdout }) => {
				stdout(String(await config.get("pager")));
				await config.list();
			}),
		);
		const direct = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		try {
			const warning = `Warning: ${projectFile()} sets "pager", which only ${userFile()} may set; ignored.\n`;
			expect(await captureExecute(app, ["show"])).toMatchObject({ stderr: warning });
			expect(direct).not.toHaveBeenCalled();
			// The next run warns again, and so does each of two runs at once.
			expect((await captureExecute(app, ["show"])).stderr).toBe(warning);
			const [first, second] = await Promise.all([
				captureExecute(app, ["show"]),
				captureExecute(app, ["show"]),
			]);
			expect([first.stderr, second.stderr]).toEqual([warning, warning]);
			expect(direct).not.toHaveBeenCalled();
			// Outside a run, a read warns on the process's stderr.
			await config.get("pager");
			expect(direct).toHaveBeenCalledWith(warning);
		} finally {
			direct.mockRestore();
		}
	});
});

describe("a setting only the project file may hold", () => {
	const tool = () => {
		const config = defineConfig({
			name: "acme",
			user: { pager: { type: "string" } },
			project: { entry: { type: "string" } },
			both: { region: { type: "string" } },
			command: true,
		});
		return { config, app: new Crust("acme").extend(config.extension) };
	};

	it("is read from the project file, and ignored in the user's file with a warning", async () => {
		const { config } = tool();
		write(userFile(), { entry: "from-user.ts", region: "eu" });
		const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		try {
			expect(await config.get("entry")).toBeUndefined();
			expect(warn).toHaveBeenCalledWith(
				`Warning: ${userFile()} sets "entry", which only acme.config.json may set; ignored.\n`,
			);
		} finally {
			warn.mockRestore();
		}
		write(projectFile(), { entry: "src/main.ts" });
		expect(await config.get("entry")).toBe("src/main.ts");
		expect(await config.get("region")).toBe("eu");
	});

	it("does not stand in the way of a setting it cannot hold: only the files that may hold a setting are read", async () => {
		const { config } = tool();
		write(userFile(), { pager: "less" });
		write(projectFile(), "{ broken");
		expect(await config.get("pager")).toBe("less");
		await expect(config.get("region")).rejects.toThrow(`Malformed config file: ${projectFile()}`);
		write(projectFile(), { entry: "src/main.ts" });
		write(userFile(), "{ broken");
		expect(await config.get("entry")).toBe("src/main.ts");
	});

	it("fails list() only for a setting a broken file would have given", async () => {
		const config = defineConfig({
			name: "acme",
			user: { pager: { type: "string" } },
			project: { entry: { type: "string", env: "ACME_ENTRY" } },
		});
		write(userFile(), { pager: "less" });
		write(projectFile(), "{ broken");
		await expect(config.list()).rejects.toThrow(`Malformed config file: ${projectFile()}`);
		// Its variable gives entry, so nothing is asked of the broken file.
		await withEnv({ ...process.env, ACME_ENTRY: "src/main.ts" }, async () => {
			expect(await config.list()).toEqual([
				{ key: "pager", value: "less", source: { kind: "file", path: userFile() } },
				{ key: "entry", value: "src/main.ts", source: { kind: "env", name: "ACME_ENTRY" } },
			]);
		});
	});

	it.skipIf(process.platform === "win32")(
		"reads a project setting when the user's folder cannot be resolved",
		async () => {
			const { config } = tool();
			write(projectFile(), { entry: "src/main.ts", pager: "less" });
			// No configuration folder: a relative home, and no XDG_CONFIG_HOME.
			const home = vi
				.spyOn(process.getBuiltinModule("node:os"), "homedir")
				.mockReturnValue("relative");
			await withEnv({ ...process.env, XDG_CONFIG_HOME: undefined }, async () => {
				const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
				try {
					expect(await config.get("entry")).toBe("src/main.ts");
					expect(warn).toHaveBeenCalledWith(
						`Warning: ${projectFile()} sets "pager", which only config.json may set; ignored.\n`,
					);
					await expect(config.get("pager")).rejects.toThrow();
				} finally {
					warn.mockRestore();
					home.mockRestore();
				}
			});
		},
	);

	it("is saved only in the project file", async () => {
		const { config, app } = tool();
		await config.set({ entry: "src/main.ts" }, { project: true });
		expect(await config.get("entry")).toBe("src/main.ts");
		// SAFETY: the compile error is covered in config.test-d.ts; this is the same rule at run time.
		await expect(config.set({ entry: "x" } as never)).rejects.toThrow(
			'config.json cannot set "entry"; it may set only: region, pager',
		);
		expect(await captureExecute(app, ["config", "set", "entry", "x"])).toMatchObject({
			exitCode: 2,
			stderr: 'Error: "entry" is a setting of acme.config.json: pass --project\n',
		});
		expect(await captureExecute(app, ["config", "set", "--project", "entry", "x"])).toMatchObject({
			exitCode: 0,
		});
		expect(await config.get("entry")).toBe("x");
	});

	it("makes a config with no other kind: the user's file is never read, and saves need no flag", async () => {
		const config = defineConfig({
			name: "acme",
			project: { entry: { type: "string" } },
			command: true,
		});
		const app = new Crust("acme").extend(config.extension);
		write(userFile(), "{ broken");
		expect(await captureExecute(app, ["config", "set", "entry", "src/main.ts"])).toMatchObject({
			exitCode: 0,
			stdout: `Saved entry in ${join(root, "repo", "sub", "acme.config.json")}\n`,
		});
		expect(await config.get("entry")).toBe("src/main.ts");
		expect((await captureExecute(app, ["config", "set", "--project", "entry", "x"])).exitCode).toBe(
			2,
		);
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

	it("takes the files' format, and their names without the extension", async () => {
		write(userFile("config.ini"), "region = eu\n");
		write(projectFile("acme.config.ini"), "replicas = 3\n");
		const format = { extension: "ini", ...ini };
		const { app, config } = acme({ format });
		const { stdout } = await captureExecute(app, ["deploy"]);
		expect(JSON.parse(stdout)).toMatchObject({ region: "eu", replicas: 3 });
		await config.set({ pager: "less" });
		expect(readFileSync(userFile("config.ini"), "utf8")).toBe("region=eu\npager=less\n");

		write(userFile("settings.ini"), "region = eu\n");
		write(projectFile("acme.ini"), "replicas = 4\n");
		const named = acme({ format, files: { user: "settings", project: "acme" } });
		expect(await named.config.get("replicas")).toBe(4);
		expect(await named.config.get("region")).toBe("eu");
	});

	it("names a file that cannot be read", async () => {
		mkdirSync(userFile(), { recursive: true });
		expect(await captureExecute(acme().app, ["deploy"])).toMatchObject({
			exitCode: 2,
			stderr: `Error: Cannot read config file: ${userFile()}\n`,
		});
	});

	it.skipIf(process.platform === "win32")("refuses a file that is not a regular file", async () => {
		symlinkSync("/dev/null", projectFile());
		expect(await captureExecute(acme().app, ["deploy"])).toMatchObject({
			exitCode: 2,
			stderr: `Error: Cannot read config file: ${projectFile()}\n`,
		});
	});

	it("names a file that does not hold an object", async () => {
		write(userFile(), "[1]");
		await expect(acme().config.get("pager")).rejects.toThrow(
			`Malformed config file: ${userFile()}`,
		);
	});
});

describe("get, list and set", () => {
	it("get() reads a setting from its variable, the files or its default", async () => {
		const { config } = acme();
		expect(await config.get("timeout")).toBe(30_000);
		expect(await config.get("replicas")).toBeUndefined();
		write(userFile(), { region: "eu" });
		expect(await config.get("region")).toBe("eu");
		await withEnv({ ...process.env, ACME_REGION: "us" }, async () => {
			expect(await config.get("region")).toBe("us");
		});
	});

	it("get() takes the first variable that is set, as the flag does, though it converts to nothing", async () => {
		const config = defineConfig({
			name: "acme",
			user: {
				tags: { type: "string", multiple: true, delimiter: ",", env: ["A", "B"], default: ["d"] },
			},
		});
		await withEnv({ ...process.env, A: ",", B: "later" }, async () => {
			expect(await config.get("tags")).toEqual(["d"]);
			expect(await config.list()).toEqual([
				{ key: "tags", value: ["d"], source: { kind: "default" } },
			]);
		});
	});

	it("get() throws for a required setting that nothing gives", async () => {
		const config = defineConfig({
			name: "acme",
			user: { org: { type: "string", env: "ACME_ORG", required: true } },
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
				{ key: "tags", value: ["a"], source: { kind: "file", path: projectFile() } },
				{ key: "timeout", value: 30_000, source: { kind: "default" } },
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

	it("set() gives the replacement the file's owner, as an elevated save must", async () => {
		write(userFile(), {});
		const { uid, gid } = statSync(userFile());
		const chown = vi.spyOn(process.getBuiltinModule("node:fs/promises"), "chown");
		try {
			await acme().config.set({ region: "eu" });
			expect(chown).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), uid, gid);
		} finally {
			chown.mockRestore();
		}
	});

	it("set() saves in call order, and saves the values it checked", async () => {
		const { config } = acme();
		await Promise.all([
			config.set({ region: "eu", pager: "less" }),
			config.set({ region: "eu" }),
			config.set({ region: "us" }),
		]);
		const patch = { replicas: 3, tags: ["a"] };
		const saving = config.set(patch);
		patch.replicas = 0;
		patch.tags.push("b");
		await saving;
		expect(JSON.parse(readFileSync(userFile(), "utf8"))).toEqual({
			region: "us",
			pager: "less",
			replicas: 3,
			tags: ["a"],
		});
	});

	it("set() of two configs of one name at once keeps both keys", async () => {
		write(userFile(), {});
		const [first, second] = [acme().config, acme().config];
		await Promise.all([first.set({ region: "eu" }), second.set({ pager: "less" })]);
		expect(JSON.parse(readFileSync(userFile(), "utf8"))).toEqual({ region: "eu", pager: "less" });
	});

	it("set() refuses a save that would make the file larger than 16 MiB, keeping the file", async () => {
		write(userFile(), { pager: "keep" });
		const { config } = acme();
		await expect(config.set({ tags: ["x".repeat(16 * 1024 * 1024)] })).rejects.toThrow(
			`Cannot save ${userFile()}: the file would be larger than 16 MiB`,
		);
		expect(await config.get("pager")).toBe("keep");
	});

	it("set() refuses a value the setting's rules refuse, saving nothing", async () => {
		const { config } = acme();
		await expect(config.set({ region: "eu", replicas: 0 })).rejects.toThrow(
			'Expected an integer of at least 1 for "replicas".',
		);
		await expect(config.set({ replicas: Number.NaN })).rejects.toThrow(
			'Expected an integer for "replicas".',
		);
		expect(existsSync(userFile())).toBe(false);
	});

	it.skipIf(process.platform === "win32")(
		"set() saves the file a linked user's file points to, and keeps the link",
		async () => {
			const target = join(root, "dotfiles", "config.json");
			write(target, { pager: "less" });
			mkdirSync(dirname(userFile()), { recursive: true });
			symlinkSync(target, userFile());
			await acme().config.set({ region: "eu" });
			expect(lstatSync(userFile()).isSymbolicLink()).toBe(true);
			expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ pager: "less", region: "eu" });
		},
	);

	it.skipIf(process.platform === "win32")(
		"set(values, { project: true }) refuses a linked project file",
		async () => {
			const target = join(root, "secrets.json");
			write(target, { region: "us", token: "secret" });
			symlinkSync(target, projectFile());
			await expect(acme().config.set({ region: "eu" }, { project: true })).rejects.toThrow(
				`${projectFile()} is a symbolic link; replace it with a file to save in it`,
			);
			expect(lstatSync(projectFile()).isSymbolicLink()).toBe(true);
			expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ region: "us", token: "secret" });
		},
	);

	it("set(values, { project: true }) writes the nearest project file, or one here", async () => {
		const { config } = acme();
		await config.set({ replicas: 2 }, { project: true });
		expect(JSON.parse(readFileSync(join(root, "repo", "sub", "acme.config.json"), "utf8"))).toEqual(
			{ replicas: 2 },
		);
	});

	it("set(values, { project: true }) saves in the project it was called in", async () => {
		const { config } = acme();
		const saving = config.set({ replicas: 2 }, { project: true });
		// The working directory changes before the queued save runs.
		process.chdir(root);
		await saving;
		expect(existsSync(join(root, "acme.config.json"))).toBe(false);
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
				"tags             unset",
				"timeout   30000  default",
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
		"then acme.config.json (the nearest from the working directory up), then config.json in the configuration directory of acme, then its default.",
	);
	// A setting one file may hold says which.
	expect(stdout).toMatch(/^ {2}pager +\(config\.json only\)$/m);
	expect(stdout).toMatch(/^ {2}tags$/m);
});

it("runs as if started in another folder with a -C Extension listed first", async () => {
	write(join(root, "other", "acme.config.json"), { replicas: 7 });
	const { config } = acme();
	const chdir = defineExtension("app:chdir")
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
			replicas: { type: "integer", minimum: 1 },
			timeout: { type: "string", default: "30" },
			tags: { type: "array", items: { type: "string" } },
		},
		additionalProperties: false,
	});
	// The project file's schema holds the settings that file may hold.
	expect(Object.keys(config.jsonSchema({ project: true }).properties as object)).toEqual([
		"$schema",
		"region",
		"replicas",
		"tags",
	]);
});

it("leaves out a bound that is not finite from the JSON Schema", () => {
	const config = defineConfig({
		name: "acme",
		user: { a: { type: "number", min: Number.NaN, max: Number.POSITIVE_INFINITY } },
	});
	expect(config.jsonSchema().properties).toEqual({
		$schema: { type: "string" },
		a: { type: "number" },
	});
});
