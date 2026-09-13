import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const stamp = defineExtension<"version">()(defineExtensionId("acme:stamp"), {
  hooks: {
    preRun(ctx) {
      ctx.stdout(`version ${ctx.rootCommand.meta.version}`);
    },
  },
});

// new Crust("my-cli").extend(stamp);
// Type error: the root metadata does not guarantee "version".

const app = new Crust("my-cli", { version: "1.2.3" }).extend(stamp).action(() => {});
console.log((await app.run([])).stdout); // => "version 1.2.3"
