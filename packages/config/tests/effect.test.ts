// `service(config)` from @crustjs/effect reads the config, whose factory is a structural copy.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
import { handler, service } from "@crustjs/effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";

import { defineConfig } from "../src/index.ts";

let root: string;
const saved = {
	cwd: process.cwd(),
	xdg: process.env.XDG_CONFIG_HOME,
	appData: process.env.APPDATA,
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-config-effect-"));
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
	rmSync(root, { recursive: true, force: true });
});

const config = defineConfig({
	name: "acme",
	global: true,
	flags: { org: { type: "string", default: "from-default" } },
});

const org = handler(function* () {
	return (yield* service(config)).org;
});

it("service(config) reads the provided config and its .of() double", async () => {
	expect(await new Crust("acme").provide(config()).action(org).run([])).toMatchObject({
		status: "completed",
		result: "from-default",
	});
	expect(
		await new Crust("acme")
			.provide(config.of({ org: "double" }))
			.action(org)
			.run([]),
	).toMatchObject({ status: "completed", result: "double" });
});
