import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const preview = defineExtension(defineExtensionId("acme:preview"))
	.flags({ name: "preview", type: "boolean", description: "Show the plan" })
	.preRun((ctx) => {
		if (ctx.flags.preview !== true) return;
		ctx.stdout("nothing changed");
		return ctx.handled(); // [!code highlight]
	});

const app = new Crust("deploy").extend(preview).action(({ stdout }) => stdout("deployed"));
await app.execute();
