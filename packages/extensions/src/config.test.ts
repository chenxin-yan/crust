/**
 * @module-tag windows
 * @module-tag macos
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	Crust,
	defineExtension,
	defineExtensionId,
	type ExtensionContext,
	type FlagsDef,
} from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { config } from "./config.ts";
import { help } from "./help.ts";
import { input } from "./input.ts";
import { version } from "./version.ts";

let root: string;
let userDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-"));
	const cwd = join(root, "repo", "a", "b");
	mkdirSync(cwd, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(cwd);
	// configDir reads APPDATA on Windows and XDG_CONFIG_HOME elsewhere.
	userDir = join(root, "user");
	vi.stubEnv("XDG_CONFIG_HOME", userDir);
	vi.stubEnv("APPDATA", userDir);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

const projectFile = () => join(root, "repo", "acme.config.json");
const userFile = () => join(userDir, "acme", "config.json");

const flags = {
	org: { type: "string", env: { name: "ACME_ORG" }, config: "org" },
	region: { type: "string", config: "region", default: "us" },
	port: { type: "number", config: "port" },
} as const satisfies FlagsDef;

function acme(...order: readonly ("config" | "input")[]) {
	const seen: ExtensionContext["sources"]["flags"][] = [];
	const extensions = order.map((name) =>
		name === "config" ? config({ name: "acme", project: "acme.config.json", user: true }) : input(),
	);
	const app = new Crust("acme")
		.flags(flags)
		.extend(
			...extensions,
			defineExtension(defineExtensionId("seen")).preRun((ctx) => void seen.push(ctx.sources.flags)),
		)
		.action(({ flags }) => flags);
	return { app, seen };
}

describe("config()", () => {
	it("walks up to the project file, which wins over the user file key by key", async () => {
		write(projectFile(), JSON.stringify({ org: "project" }));
		write(userFile(), JSON.stringify({ org: "user", region: "eu", unrelated: 1 }));
		const { app, seen } = acme("config");
		expect(await app.run([])).toMatchObject({ result: { org: "project", region: "eu" } });
		expect(seen).toEqual([{ org: "config", region: "config" }]);
	});

	it("stops at the filesystem root with nothing found", async () => {
		const { app, seen } = acme("config");
		expect(await app.run([])).toMatchObject({ result: { org: undefined, region: "us" } });
		expect(seen).toEqual([{ region: "default" }]);
	});

	it("reads the user file only when asked", async () => {
		write(userFile(), JSON.stringify({ org: "user" }));
		const app = new Crust("acme")
			.flags(flags)
			.extend(config({ name: "acme", project: "acme.config.json" }))
			.action(({ flags }) => flags.org);
		expect(await app.run([])).toMatchObject({ result: undefined });
	});

	it("ranks argv > env > config", async () => {
		write(projectFile(), JSON.stringify({ org: "file" }));
		const { app, seen } = acme("config");
		await captureExecute(app, ["--org", "argv"], { env: { ACME_ORG: "env" } });
		await captureExecute(app, [], { env: { ACME_ORG: "env" } });
		await captureExecute(app, [], { env: {} });
		expect(seen.map(({ org }) => org)).toEqual(["argv", "env", "config"]);
	});

	it.each([
		["config", "input"],
		["input", "config"],
	] as const)("--input wins over config in either Extension order (%s, %s)", async (...order) => {
		write(projectFile(), JSON.stringify({ org: "file", port: 1 }));
		const { app, seen } = acme(...order);
		await captureExecute(app, ["--input", '{"org":"input"}'], { env: {} });
		expect(seen).toEqual([{ org: "bound", port: "config", region: "default", input: "argv" }]);
	});

	it("converts URL strings and passes arrays to multiple flags", async () => {
		write(projectFile(), JSON.stringify({ origin: "https://api.example.com/", tags: ["a", "b"] }));
		const app = new Crust("acme")
			.flags({
				origin: { type: "url", config: "origin" },
				tags: { type: "string", multiple: true, config: "tags" },
			})
			.extend(config({ name: "acme", project: "acme.config.json" }))
			.action(({ flags }) => ({ origin: flags.origin?.href, tags: flags.tags }));
		expect(await app.run([])).toMatchObject({
			result: { origin: "https://api.example.com/", tags: ["a", "b"] },
		});
	});

	it.each([
		["port", '"s3cret"', "Expected a number"],
		["org", "null", "Expected a string"],
	])(
		"names the file and key of an invalid %s value, never the value",
		async (key, value, message) => {
			write(projectFile(), `{ "${key}": ${value} }`);
			const { app } = acme("config");
			expect(await captureExecute(app, [], { env: {} })).toMatchObject({
				exitCode: 1,
				stderr: `Error: ${message} for --${key} (from ${projectFile()} key "${key}").`,
			});
		},
	);

	it("defers an invalid value, so --help still works", async () => {
		write(projectFile(), JSON.stringify({ port: "s3cret" }));
		const app = acme("config").app.extend(help());
		const { exitCode, stdout } = await captureExecute(app, ["--help"], { env: {} });
		expect(exitCode).toBe(0);
		expect(stdout).toContain("[config: port]");
	});

	it("reads a file saved with a byte order mark", async () => {
		write(projectFile(), `\uFEFF${JSON.stringify({ org: "bom" })}`);
		expect(await acme("config").app.run([])).toMatchObject({ result: { org: "bom" } });
	});

	it.each([
		["{ org: s3cret", "Invalid JSON in config file"],
		['["s3cret"]', "must contain a JSON object"],
		["", "Invalid JSON in config file"],
	])("rejects a malformed file by path without printing it: %j", async (text, message) => {
		write(userFile(), text);
		const { exitCode, stderr } = await captureExecute(acme("config").app, [], { env: {} });
		expect(exitCode).toBe(1);
		expect(stderr).toContain(userFile());
		expect(stderr).toContain(message);
		expect(stderr).not.toContain("s3cret");
	});

	it("answers --help and --version with a broken file, binding none of its values", async () => {
		write(projectFile(), "{ not json");
		const seen: ExtensionContext["sources"]["flags"][] = [];
		const app = new Crust("acme")
			.flags(flags)
			.extend(
				// Registered after config(): its setup still sees no config values.
				config({ name: "acme", project: "acme.config.json" }),
				defineExtension(defineExtensionId("seen")).setup(
					(ctx) => void seen.push(ctx.sources.flags),
				),
				help(),
				version("1.2.3"),
			)
			.action(() => "ran");
		const helped = await captureExecute(app, ["--help"], { env: {} });
		expect(helped).toMatchObject({ exitCode: 0, stderr: "" });
		expect(helped.stdout).toContain("[config: port]");
		expect(await captureExecute(app, ["--version"], { env: {} })).toMatchObject({
			exitCode: 0,
			stdout: expect.stringContaining("1.2.3"),
		});
		expect(await captureExecute(app, [], { env: {} })).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: `Error: Invalid JSON in config file ${projectFile()}.`,
		});
		expect(seen).toEqual([
			{ region: "default", help: "argv" },
			{ region: "default", version: "argv" },
			{ region: "default" },
		]);
	});

	const posix = process.platform !== "win32";
	const MiB = 1024 * 1024;
	/** `{"org":"x"}` padded with spaces to `size` bytes. */
	const sized = (size: number) => JSON.stringify({ org: "x" }).padEnd(size, " ");

	/** A file error fails the command, naming only the path; `--help` still answers. */
	async function expectFileError(path: string, message: string) {
		const app = acme("config").app.extend(help());
		const { exitCode, stderr } = await captureExecute(app, [], { env: {} });
		expect({ exitCode, stderr }).toEqual({ exitCode: 1, stderr: `Error: ${message}` });
		expect(stderr).toContain(path);
		expect(await captureExecute(app, ["--help"], { env: {} })).toMatchObject({ exitCode: 0 });
	}

	it("reads a file of exactly 1 MiB and rejects a larger one", async () => {
		write(projectFile(), sized(MiB));
		expect(await acme("config").app.run([])).toMatchObject({ result: { org: "x" } });
		write(projectFile(), sized(MiB + 1));
		await expectFileError(projectFile(), `Config file ${projectFile()} is larger than 1 MiB.`);
	});

	it("rejects a file that grew past 1 MiB after it was opened", async () => {
		write(userFile(), sized(2 * MiB));
		const fs = process.getBuiltinModule("node:fs");
		const fstatSync = fs.fstatSync;
		// The size seen when the file was opened, before it grew.
		vi.spyOn(fs, "fstatSync").mockImplementation((fd) =>
			Object.assign(fstatSync(fd), { size: 16 }),
		);
		await expectFileError(userFile(), `Config file ${userFile()} is larger than 1 MiB.`);
	});

	it("rejects a directory where the user file should be", async () => {
		mkdirSync(userFile(), { recursive: true });
		await expectFileError(userFile(), `Config file ${userFile()} is not a regular file.`);
	});

	it.skipIf(!posix)("rejects a FIFO without waiting for a writer", async () => {
		mkdirSync(dirname(userFile()), { recursive: true });
		execFileSync("mkfifo", [userFile()]);
		await expectFileError(userFile(), `Config file ${userFile()} is not a regular file.`);
	});

	it.skipIf(!posix)("follows a symlink to a regular file", async () => {
		write(join(root, "real.json"), JSON.stringify({ org: "linked" }));
		symlinkSync(join(root, "real.json"), projectFile());
		expect(await acme("config").app.run([])).toMatchObject({ result: { org: "linked" } });
	});

	it.skipIf(!posix)("names the path when the project search hits a symlink loop", async () => {
		symlinkSync(projectFile(), projectFile());
		await expectFileError(projectFile(), `Cannot read config file ${projectFile()}.`);
	});

	it.skipIf(!posix || process.getuid?.() === 0)(
		"names the path when the project search cannot enter a directory",
		async () => {
			const locked = join(root, "repo", "a");
			chmodSync(locked, 0o000);
			try {
				const candidate = join(locked, "b", "acme.config.json");
				await expectFileError(candidate, `Cannot read config file ${candidate}.`);
			} finally {
				chmodSync(locked, 0o755);
			}
		},
	);

	it("reads no file for a command without config keys", async () => {
		write(projectFile(), "{ not json");
		const app = new Crust("acme")
			.flags({ org: { type: "string" } })
			.extend(config({ name: "acme", project: "acme.config.json", user: true }))
			.action(() => "ran");
		expect(await app.run([])).toMatchObject({ result: "ran" });
	});
});
