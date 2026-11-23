// Generated OpenAPI commands read a setting through `bind`; the config knows nothing about openapi.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
import { defineApi } from "@crustjs/openapi";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { defineConfig } from "../src/index.ts";

let root: string;
const saved = {
	cwd: process.cwd(),
	xdg: process.env.XDG_CONFIG_HOME,
	appData: process.env.APPDATA,
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-openapi-"));
	// configDir() reads XDG_CONFIG_HOME on Linux and macOS, APPDATA on Windows: both point here.
	process.env.XDG_CONFIG_HOME = join(root, "xdg");
	process.env.APPDATA = join(root, "xdg");
	process.chdir(root);
});

afterEach(() => {
	process.chdir(saved.cwd);
	for (const [name, value] of [
		["XDG_CONFIG_HOME", saved.xdg],
		["APPDATA", saved.appData],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true, force: true });
});

const config = defineConfig({
	name: "acme",
	global: true,
	project: true,
}).flags({
	account: {
		type: "string",
		description: "Account ID",
		env: { name: "ACME_ACCOUNT" },
		required: true,
	},
});

const api = defineApi({
	spec: {
		openapi: "3.1.0",
		paths: {
			"/accounts/{account_id}/zones": {
				get: {
					operationId: "listZones",
					tags: ["Zones"],
					summary: "List zones",
					parameters: [
						{ name: "account_id", in: "path", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "Zones" } },
				},
			},
		},
	},
	baseUrl: "https://api.acme.example/v1",
})
	.use(config.settings.account)
	.each(() => ({ bind: { account_id: (ctx) => ctx.account } }));

const app = new Crust("acme").extend(config.extension, api.extension).add(...api.commands);

/** The URLs the generated command requested. */
function requests(): string[] {
	const urls: string[] = [];
	vi.stubGlobal("fetch", async (...args: ConstructorParameters<typeof Request>) => {
		urls.push(new Request(...args).url);
		return Response.json([]);
	});
	return urls;
}

it("a generated command binds a setting from the project file, or from its flag", async () => {
	writeFileSync(join(root, "acme.config.json"), JSON.stringify({ account: "from-file" }));
	const urls = requests();
	expect(await captureExecute(app, ["zones", "list-zones"], { env: {} })).toMatchObject({
		exitCode: 0,
	});
	expect(
		await captureExecute(app, ["zones", "list-zones", "--account", "from-flag"], { env: {} }),
	).toMatchObject({ exitCode: 0 });
	expect(urls).toEqual([
		"https://api.acme.example/v1/accounts/from-file/zones",
		"https://api.acme.example/v1/accounts/from-flag/zones",
	]);
});

it("a generated command fails a missing setting before any request", async () => {
	mkdirSync(join(root, "xdg"));
	const urls = requests();
	const { exitCode, stderr } = await captureExecute(app, ["zones", "list-zones"], { env: {} });
	expect(exitCode).toBe(2);
	expect(stderr).toContain('Missing setting "account" of acme: pass --account, set ACME_ACCOUNT');
	expect(urls).toEqual([]);
});

it("api preview calls no binding, so it reads no file", async () => {
	writeFileSync(join(root, "acme.config.json"), "{ broken");
	const { exitCode, stdout, stderr } = await captureExecute(app, [
		"api",
		"preview",
		"zones",
		"list-zones",
	]);
	expect(exitCode, stderr).toBe(0);
	expect(JSON.parse(stdout)).toMatchObject({
		url: "https://api.acme.example/v1/accounts/{account_id}/zones",
		bound: ["account_id"],
	});
});
