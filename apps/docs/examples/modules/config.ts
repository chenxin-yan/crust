//#region quick-example
import { defineConfig } from "@crustjs/config";
import { defineCommand } from "@crustjs/core";

export const config = defineConfig({
	name: "acme",
	// Each setting is a flag definition, as in a command's .flags({...}).
	settings: {
		org: { type: "string", description: "Organization", env: "ACME_ORG", required: true },
		region: { type: "string", choices: ["us", "eu"], default: "us", description: "Region" },
		port: { type: "number", description: "Port" },
		pager: { type: "string", description: "Pager for long output" },
	},
	// A repository's acme.config.json may set only these.
	project: ["org", "region"],
	// Adds `acme config get|set|unset|list`.
	command: true,
});

// deploy takes --org and --region; their values come from the files when not given.
const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command
		.flags({ org: config.flag("org"), region: config.flag("region") })
		.action(({ flags, stdout }) => {
			const where = flags.region;
			//    ^?
			stdout(`deploying ${flags.org} to ${where}`);
		}),
);
//#endregion

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";
import { defineApi } from "@crustjs/openapi";

//#region flag-name
// The command names the flag: `acme serve --listen 8080` sets the `port` setting for this run.
const serve = defineCommand("serve", { description: "Serve the app" }, (command) =>
	command
		.flags({ listen: config.flag("port") })
		.action(({ flags, stdout }) => stdout(`listening on ${flags.listen ?? 3000}`)),
);
//#endregion

//#region get-set
// `acme use eu` saves the region in the user's file; `acme pager` reads a setting no flag has.
const use = defineCommand("use", { description: "Save a region" }, (command) =>
	command
		.args({ name: "region", type: "string", choices: ["us", "eu"], required: true })
		.action(async ({ args, stdout }) => {
			await config.set({ region: args.region });
			stdout(`region saved: ${args.region}`);
		}),
);
const pager = defineCommand("pager", { description: "Print the pager" }, (command) =>
	command.action(async ({ stdout }) => stdout((await config.get("pager")) ?? "less")),
);
//#endregion

//#region chdir
// `acme -C ../other deploy` runs as if started in ../other, so that folder's project file applies.
// Listed before config.extension: setups run in .extend() order.
const chdir = defineExtension(defineExtensionId("acme:chdir"))
	.flags({ dir: { type: "path", short: "C", description: "Run as if started in this folder" } })
	.setup((ctx) => {
		if (ctx.flags.dir !== undefined) process.chdir(ctx.flags.dir);
	});
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
	// `{org}` in every generated command's path comes from the setting.
	.each(() => ({ bind: { org: () => config.get("org") } }));
//#endregion

//#region app
export const app = new Crust("acme", { version: "1.0.0" })
	.extend(help(), version(), chdir, config.extension, configSchema, api.extension)
	.add(deploy, serve, use, pager, ...api.commands);
//#endregion
