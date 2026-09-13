import { Crust } from "@crustjs/core";

const publish = new Crust("publish")
  .flags(
    { name: "token", type: "string", required: true },
    { name: "registry", type: "string", default: "npm" },
  )
  .action(({ flags, stdout }) => {
    stdout(`publishing to ${flags.registry}`);
  });

await publish.execute();
