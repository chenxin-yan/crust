import { Crust, defineCommand } from "@crustjs/core";
import { completion } from "@crustjs/extensions";

const app = new Crust("my-cli", { version: "1.2.3" })
  .extend(completion())
  .add(
    defineCommand("build", (command) =>
      command
        .flags({ name: "target", type: "string", choices: ["browser", "bun", "node"] })
        .action(() => {}),
    ),
  )
  .action(() => {});

await app.execute();
