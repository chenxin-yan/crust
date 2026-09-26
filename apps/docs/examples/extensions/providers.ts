import { Crust, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";

const logger = defineContext("logger", ({ stdout }) => ({ info: stdout }));

export const logging = defineExtension(defineExtensionId("acme:logging"), {
	// [!code highlight]
	provides: [logger()],
	uses: [logger], // [!code highlight]
	hooks: {
		async postRun({ ctx }, outcome) {
			(await ctx.logger).info(`outcome: ${outcome.status}`);
			//         ^?
		},
	},
});

const app = new Crust("my-cli").extend(logging).action(({ stdout }) => stdout("ready"));
await app.execute();
