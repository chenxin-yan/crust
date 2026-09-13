import { Crust, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";

const logger = defineContext("logger", ({ stdout }) => ({ info: stdout }));

export const logging = defineExtension(defineExtensionId("acme:logging"), {
  provides: [logger()],
});

const app = new Crust("my-cli").extend(logging).action(async ({ ctx }) => {
  (await ctx.logger).info("ready");
});

console.log((await app.run([])).stdout); // => "ready"
