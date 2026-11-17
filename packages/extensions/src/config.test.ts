/**
 * @module-tag windows
 * @module-tag macos
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	])(
		"rejects a malformed file by path without printing it, even for --help: %j",
		async (text, message) => {
			write(userFile(), text);
			const app = acme("config").app.extend(help());
			for (const argv of [[], ["--help"]]) {
				const { exitCode, stderr } = await captureExecute(app, argv, { env: {} });
				expect(exitCode).toBe(1);
				expect(stderr).toContain(userFile());
				expect(stderr).toContain(message);
				expect(stderr).not.toContain("s3cret");
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
