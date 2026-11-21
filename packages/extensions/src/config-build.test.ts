import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { configBuildArtifacts } from "./config-build.ts";

async function build(app: AnyCrust) {
	return configBuildArtifacts(await app.snapshot());
}

async function schemaOf(app: AnyCrust) {
	const files = await build(app);
	expect(files.map(({ path }) => path)).toEqual(["config/schema.json"]);
	return JSON.parse(String(files[0]!.content));
}

describe("configBuildArtifacts()", () => {
	it("writes nothing when no flag declares a config key", async () => {
		const app = new Crust("acme").flags({ org: { type: "string" } }).action(() => {});
		expect(await build(app)).toEqual([]);
	});

	it("writes one property per key with the first description in command-tree order", async () => {
		const app = new Crust("acme")
			.flags({
				org: {
					type: "string",
					description: "Organization",
					env: { name: "ACME_ORG" },
					config: "org",
				},
				region: { type: "string", choices: ["us", "eu"], default: "us", config: "region" },
			})
			.add(
				defineCommand("deploy", (cmd) =>
					cmd
						.flags({
							organization: { type: "string", description: "Deploy as", config: "org" },
							region: {
								type: "string",
								choices: ["us", "eu"],
								description: "Where",
								config: "region",
							},
							port: { type: "number", description: "Port", config: "port" },
							tags: { type: "string", multiple: true, config: "tags" },
							origin: { type: "url", config: "origin" },
							verbose: { type: "boolean" },
						})
						.action(() => {}),
				),
			)
			.action(() => {});
		expect(await schemaOf(app)).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			title: "acme config file",
			type: "object",
			properties: {
				$schema: { type: "string", description: "The JSON Schema this file follows" },
				org: { type: "string", description: "Organization" },
				region: { type: "string", enum: ["us", "eu"], description: "Where" },
				port: { type: "number", description: "Port" },
				tags: { type: "array", items: { type: "string" } },
				origin: { type: "string", format: "uri" },
			},
			additionalProperties: false,
		});
	});

	it("lets flags of one command share a key when their shapes are equal", async () => {
		const app = new Crust("acme")
			.flags({
				a: { type: "string", config: "org" },
				b: { type: "string", default: "x", description: "B", config: "org" },
			})
			.action(() => {});
		expect((await schemaOf(app)).properties.org).toEqual({ type: "string", description: "B" });
	});

	it("compares a flag with a custom parse as its token type", async () => {
		const parsed = {
			type: "string",
			parse: (value: string) => value.length,
			config: "size",
		} as const;
		const asString = new Crust("acme")
			.flags({ parsed, plain: { type: "string", config: "size" } })
			.action(() => {});
		expect((await schemaOf(asString)).properties.size).toEqual({ type: "string" });
		const asNumber = new Crust("acme")
			.flags({ parsed, count: { type: "number", config: "size" } })
			.action(() => {});
		await expect(build(asNumber)).rejects.toThrow(
			[
				"config: 1 problem needs a decision before this CLI can be built.",
				"",
				'  config key "size" is declared with different types:',
				"    acme --parsed  string",
				"    acme --count  number",
				"    fix: give them one type, or give one of them another key",
			].join("\n"),
		);
	});

	it("fails with every key whose flags differ in shape, and a $schema key", async () => {
		const app = new Crust("acme")
			.flags({
				region: { type: "string", choices: ["us", "eu"], config: "region" },
				schema: { type: "string", config: "$schema" },
			})
			.add(
				defineCommand("deploy", (cmd) =>
					cmd
						.flags({
							region: { type: "string", config: "region" },
							port: { type: "number", config: "port" },
						})
						.action(() => {}),
				),
			)
			.add(
				defineCommand("status", (cmd) =>
					cmd
						.flags({
							region: { type: "string", multiple: true, config: "region" },
							port: { type: "string", config: "port" },
							origin: { type: "url", config: "origin" },
						})
						.action(() => {}),
				),
			)
			.action(() => {});
		await expect(build(app)).rejects.toThrow(
			new Error(
				[
					"config: 3 problems need a decision before this CLI can be built.",
					"",
					'  config key "region" is declared with different types:',
					'    acme --region  string ("us" | "eu")',
					"    acme deploy --region  string",
					"    acme status --region  array of string",
					"    fix: give them one type, or give one of them another key",
					'  config key "$schema" names the JSON Schema of the config file:',
					"    acme --schema  string",
					"    fix: give the flag another key",
					'  config key "port" is declared with different types:',
					"    acme deploy --port  number",
					"    acme status --port  string",
					"    fix: give them one type, or give one of them another key",
				].join("\n"),
			),
		);
	});
});
