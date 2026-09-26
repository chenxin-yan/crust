import { Crust, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";

const logger = defineContext("logger", ({ stdout }) => ({ info: stdout }));

export const logging = defineExtension(defineExtensionId("acme:logging")).provide(logger());

export const audit = defineExtension(defineExtensionId("acme:audit"))
	.use(logger)
	.postRun(async ({ ctx }, outcome) => (await ctx.logger).info(`audit: ${outcome.status}`));

const app = new Crust("my-cli").extend(logging, audit).action(async ({ ctx }) => {
	(await ctx.logger).info("ready");
});

console.log((await app.run([])).stdout); // => "ready\naudit: completed"
