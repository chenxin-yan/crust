import { Crust, defineCommand } from "@crustjs/core";
import { didYouMean, help, noColor, version } from "@crustjs/extensions";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
  command.action(() => {}),
);

export const app = new Crust("my-cli", { version: "0.2.0" })
  .add(deploy)
  .extend(noColor(), version(), help(), didYouMean());

await app.execute();
