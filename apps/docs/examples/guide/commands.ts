import { Crust } from "@crustjs/core";

const tool = new Crust("tool").command("build", (command) =>
  command
    .flags({ name: "minify", type: "boolean" })
    .action(({ flags, stdout }) => stdout(`minify: ${flags.minify ?? false}`)),
);

await tool.execute();
