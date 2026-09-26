import { Crust, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";

const logger = defineContext("logger").setup(({ stdout }) => ({ info: stdout }));

export const logging = defineExtension(defineExtensionId("acme:logging"))
	.provide(logger()) // [!code highlight]
	.use(logger) // [!code highlight]
	.postRun(async ({ ctx }, outcome) => {
		(await ctx.logger).info(`outcome: ${outcome.status}`);
		//         ^?
	});

const app = new Crust("my-cli").extend(logging).action(({ stdout }) => stdout("ready"));
await app.execute();
