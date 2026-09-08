import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

const stamp = defineExtension<"version">()(defineExtensionId("acme:stamp"), {
  hooks: {
    preRun(ctx) {
      ctx.stdout(ctx.rootCommand.meta.version);
    },
  },
});

const app = new Crust("my-cli", { version: "1.2.3" }).extend(stamp).action(() => {});

await app.execute();
