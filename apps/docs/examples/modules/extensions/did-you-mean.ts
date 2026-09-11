import { Crust, defineCommand } from "@crustjs/core";
import { didYouMean } from "@crustjs/extensions";

const app = new Crust("my-cli")
  .extend(didYouMean())
  .add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
