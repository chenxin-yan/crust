import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const app = new Crust("my-cli", { description: "My CLI" })
  .extend(help())
  .add(
    defineCommand("deploy", { description: "Deploy the app" }, (command) =>
      command.action(() => {}),
    ),
  )
  .action(() => {});

await app.execute();
