import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const banner = defineExtension(defineExtensionId("acme:banner")).factory(
	(extension, text: string = "hello") => extension.preRun((ctx) => ctx.stdout(text)),
);

const app = new Crust("my-cli").extend(banner("welcome")).action(() => {});
await app.execute();
