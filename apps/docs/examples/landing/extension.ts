import {
	Crust,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const id = defineExtensionId("acme:preview");
const preview = defineExtension(id, {
	// [!code highlight]
	flags: [{ name: "preview", type: "boolean" }],
	hooks: {
		// [!code highlight]
		preRun(ctx) {
			if (ctx.flags.preview !== true) return;
			//            ^?
			ctx.stdout("nothing changed");
			return ctx.finish();
		},
	},
});

const deploy = new Crust("deploy")
	// [!code highlight]
	.extend(preview)
	.action(({ stdout }) => stdout("deployed"));

await deploy.execute();
