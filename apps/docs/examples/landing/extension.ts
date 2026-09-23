import {
	Crust,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const id = defineExtensionId("acme:preview");
const preview = defineExtension(id, {
	flags: [{ name: "preview", type: "boolean" }],
	hooks: {
		// Runs before the action; finish() skips it
		preRun(ctx) {
			if (ctx.flags.preview !== true) return;
			ctx.stdout("nothing changed");
			return ctx.finish();
		},
	},
});

const deploy = new Crust("deploy")
	.extend(preview)
	.action(({ stdout }) => stdout("deployed"));

await deploy.execute();
