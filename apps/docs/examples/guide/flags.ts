import { Crust } from "@crustjs/core";

const command = new Crust("serve")
  .flags(
    { name: "port", type: "number", default: 3000, short: "p" },
    { name: "verbose", type: "boolean", short: "v" },
  )
  .action(({ flags, stdout }) => stdout(`${flags.port} ${flags.verbose ?? false}`));

await command.execute();
