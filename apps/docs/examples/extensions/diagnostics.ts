import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";

//#region author
export const preview = defineExtension(defineExtensionId("acme:preview"))
	.flags({ name: "preview", type: "boolean", description: "Show the plan" })
	.preRun((ctx) => {
		if (ctx.flags.preview !== true) return;
		ctx.stdout("nothing changed");
		return ctx.finish();
	});

const previewApp = new Crust("deploy").extend(preview).action(() => "deployed");
const previewOutcome = await previewApp.run([], { flags: { preview: true } });
console.log(previewOutcome.status, previewOutcome.stdout); // => finished nothing changed
//#endregion

//#region factory
export const banner = defineExtension(defineExtensionId("acme:banner")).factory(
	(extension, text: string = "hello") => extension.preRun((ctx) => ctx.stdout(text)),
);

const bannerApp = new Crust("my-cli").extend(banner("welcome")).action(() => {});
console.log((await bannerApp.run([])).stdout); // => welcome
//#endregion

//#region owned-command
const doctor = defineCommand("doctor", (command) =>
	command.action(({ rootCommand, stdout }) => stdout(`checking ${rootCommand.meta.name}`)),
);

export const diagnostics = defineExtension(defineExtensionId("acme:diagnostics")).add(doctor);

const diagnosticsApp = new Crust("my-cli").extend(diagnostics);
console.log((await diagnosticsApp.run(["doctor"])).stdout); // => checking my-cli
//#endregion
