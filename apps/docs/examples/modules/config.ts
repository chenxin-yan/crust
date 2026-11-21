//#region quick-example
import { defineConfig } from "@crustjs/config";
import { defineCommand } from "@crustjs/core";

export const config = defineConfig({
	name: "acme",
	global: true, // config.json in configDir("acme"), or a file name of your own
	project: true, // acme.config.json, the nearest from the working directory up, or a file name
}).flags({
	// Each entry is a flag definition, as in a command's .flags({...}).
	org: { type: "string", description: "Organization", env: { name: "ACME_ORG" }, required: true },
	region: { type: "string", choices: ["us", "eu"], default: "us", description: "Region" },
	port: { type: "number", description: "Port" },
	// No --telemetry flag: the variable and the files only.
	telemetry: { type: "boolean", flag: false, env: { name: "ACME_TELEMETRY" } },
});

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command.use(config).action(async ({ ctx, stdout }) => {
		const { org, region, port } = await ctx.config;
		//           ^?
		stdout(`deploying ${org} to ${region}${port === undefined ? "" : ` on port ${port}`}`);
	}),
);
//#endregion

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";
import { defineApi } from "@crustjs/openapi";

//#region set
// `acme set region eu` saves a setting in the global file.
const set = defineCommand(
	"set",
	{ description: "Save a setting in the global config" },
	(command) =>
		command
			.args(
				{ name: "key", type: "string", choices: ["org", "region"], required: true },
				{ name: "value", type: "string", required: true },
			)
			.action(async ({ args, stdout }) => {
				// The store checks the value against the setting: `acme set region mars` fails.
				const saved = await config.global.patch({ [args.key]: args.value });
				stdout(`${args.key} = ${saved[args.key]}`);
			}),
);
//#endregion

//#region schema
// `crust build` writes the file's JSON Schema beside the CLI.
const configSchema = defineExtension(defineExtensionId("acme:config-schema")).build(() => [
	{ path: "config/schema.json", content: JSON.stringify(config.jsonSchema(), null, 2) },
]);
//#endregion

//#region openapi
const api = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
})
	.use(config)
	// Every generated command takes `{org}` in its path from the settings.
	.each(() => ({ bind: { org: async (ctx) => (await ctx.config).org } }));
//#endregion

//#region app
export const app = new Crust("acme", { version: "1.0.0" })
	.provide(config())
	.extend(help(), version(), configSchema, api.extension)
	.add(deploy, set, ...api.commands);
//#endregion

//#region testing
const tested = await new Crust("acme")
	.provide(config.of({ org: "test-org", region: "eu", port: undefined, telemetry: undefined }))
	.add(deploy)
	.run(["deploy"]);
//#endregion

void tested;
