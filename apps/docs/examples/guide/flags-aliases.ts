import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
  .flags({ name: "color", type: "boolean", short: "c", aliases: ["colour"] })
  .action(({ flags, stdout }) => {
    stdout(`color=${String(flags.color)}`);
  });

await serve.execute();
