// `crust build` of an app that extends config(): it writes the config file's JSON Schema, fails
// when two flags give one key different shapes, and leaves the schema builder out of the bundle.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { which } from "@crustjs/utils/process";
import { afterAll, describe, expect, it } from "vite-plus/test";

const root = mkdtempSync(join(tmpdir(), "crust-config-build-"));
const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));
const extensionsPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const crustCli = fileURLToPath(new URL("../../crust/src/cli.ts", import.meta.url));

/** A Node runtime package `acme` whose `deploy` command declares `deployFlags`, built by `crust build`. */
function crustBuild(name: string, deployFlags: string) {
	const project = join(root, name);
	mkdirSync(join(project, "src"), { recursive: true });
	writeFileSync(
		join(project, "package.json"),
		JSON.stringify({
			name: "acme",
			version: "0.1.0",
			type: "module",
			bin: { acme: "src/cli.ts" },
			crust: { runtime: "node", artifact: "package" },
		}),
	);
	writeFileSync(
		join(project, "src", "cli.ts"),
		`import { Crust, defineCommand } from ${JSON.stringify(corePath)};
import { config, help } from ${JSON.stringify(extensionsPath)};
await new Crust("acme")
	.extend(config({ name: "acme", project: "acme.config.json" }), help())
	.flags({ org: { type: "string", description: "Organization", config: "org" } })
	.add(defineCommand("deploy", (cmd) => cmd.flags(${deployFlags}).action(({ flags }) => console.log(JSON.stringify(flags)))))
	.execute();
`,
	);
	const result = spawnSync("bun", [crustCli, "build"], {
		cwd: project,
		encoding: "utf8",
		timeout: 60_000,
	});
	if (result.error) throw result.error;
	return { project, exitCode: result.status, stderr: result.stderr };
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!which("bun"))("crust build with config()", () => {
	it("writes the config file's JSON Schema and keeps its builder out of the bundle", () => {
		const { project, exitCode, stderr } = crustBuild(
			"schema",
			'{ port: { type: "number", description: "Port", config: "port" } }',
		);
		expect(exitCode, stderr).toBe(0);
		const staged = join(project, ".crust", "root");
		expect(JSON.parse(readFileSync(join(staged, "config", "schema.json"), "utf8"))).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			title: "acme config file",
			type: "object",
			properties: {
				$schema: { type: "string", description: "The JSON Schema this file follows" },
				org: { type: "string", description: "Organization" },
				port: { type: "number", description: "Port" },
			},
			additionalProperties: false,
		});
		const manifest = JSON.parse(readFileSync(join(project, ".crust", "manifest.json"), "utf8"));
		expect(JSON.stringify(manifest.build)).toContain('"config/schema.json"');

		const bundle = join(staged, "bin", "acme.js");
		expect(readFileSync(bundle, "utf8")).not.toContain("draft/2020-12");

		// The built CLI points its config file at the schema, and --help answers with a broken file.
		const cwd = join(project, "work");
		mkdirSync(cwd);
		const run = (...argv: string[]) =>
			spawnSync(process.execPath, [bundle, ...argv], { cwd, encoding: "utf8", timeout: 30_000 });
		writeFileSync(
			join(cwd, "acme.config.json"),
			JSON.stringify({ $schema: "../.crust/root/config/schema.json", port: 8080 }),
		);
		expect(run("deploy")).toMatchObject({ status: 0, stdout: '{"port":8080}\n' });
		writeFileSync(join(cwd, "acme.config.json"), "{ not json");
		expect(run("deploy", "--help")).toMatchObject({ status: 0, stderr: "" });
		expect(run("deploy")).toMatchObject({
			status: 1,
			stderr: `Error: Invalid JSON in config file ${join(cwd, "acme.config.json")}.\n`,
		});
	}, 120_000);

	it("fails when two flags give one config key different shapes", () => {
		const { exitCode, stderr } = crustBuild(
			"clash",
			'{ org: { type: "string", multiple: true, config: "org" } }',
		);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(
			[
				"config: 1 problem needs a decision before this CLI can be built.",
				"",
				'  config key "org" is declared with different types:',
				"    acme --org  string",
				"    acme deploy --org  array of string",
				"    fix: give them one type, or give one of them another key",
			].join("\n"),
		);
	}, 120_000);
});
