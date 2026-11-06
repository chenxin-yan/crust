import {
	Crust,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const id = defineExtensionId("acme:preview");
const preview = defineExtension(id)
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
