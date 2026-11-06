import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const preview = defineExtension(defineExtensionId("acme:preview"))
	.flags({ preview: { type: "boolean", description: "Show the plan" } })
	.handle("preview", (ctx) => ctx.stdout("nothing changed")); // [!code highlight]

const app = new Crust("deploy").extend(preview).action(({ stdout }) => stdout("deployed"));
await app.execute();
