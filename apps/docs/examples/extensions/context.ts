import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";

export const inspect = defineExtension(defineExtensionId("acme:inspect"), {
  hooks: {
    preRun(ctx) {
      ctx.stdout(`root: ${ctx.rootCommand.meta.name}`);
      ctx.stdout(`command: ${ctx.command.meta.name}`);
      ctx.stdout(`path: ${ctx.commandPath.join(" ")}`);
    },
  },
});

const deploy = defineCommand("deploy", (command) => command.action(() => {}));
const app = new Crust("app").add(deploy).extend(inspect);
console.log((await app.run(["deploy"])).stdout);
// root: app
// command: deploy
// path: app deploy
