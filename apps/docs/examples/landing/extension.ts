import { Crust, defineExtension } from "@crustjs/core";

const preview = defineExtension("acme:preview")
	// [!code highlight]
	.flags({ preview: { type: "boolean" } })
	.handle("preview", (ctx) => {
		ctx.stdout("nothing changed");
	});

const deploy = new Crust("deploy")
	// [!code highlight]
	.extend(preview)
	.action(({ stdout }) => stdout("deployed"));

await deploy.execute();
