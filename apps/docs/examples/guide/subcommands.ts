import { Crust, defineCommand } from "@crustjs/core";

const app = new Crust("git").add(
  defineCommand("clone", (command) =>
    command
      .args({ name: "url", type: "url", required: true })
      .action(({ args, stdout }) => stdout(`clone ${args.url}`)),
  ),
);

await app.execute();
