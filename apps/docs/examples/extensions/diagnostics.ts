import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";

const doctor = defineCommand("doctor", (command) =>
	command.action(({ rootCommand, stdout }) => stdout(`checking ${rootCommand.meta.name}`)),
);

export const diagnostics = defineExtension(defineExtensionId("acme:diagnostics"), {
	commands: [doctor], // [!code highlight]
});

const app = new Crust("my-cli").extend(diagnostics);
await app.execute();
